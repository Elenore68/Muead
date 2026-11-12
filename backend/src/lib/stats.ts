import type { TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { queryAll, TABLE, type Item } from "./db";
import { badRequest } from "./errors";
import { dayOf, monthOf } from "./requests";

/**
 * Aggregates (database-design.md 3.12).
 *   STATS#GLOBAL      / STATUS#<status>    count of requests per status
 *   STATS#GLOBAL      / CATEGORY#<name>    count of requests per category
 *   STATS#MONTH#<m>   / DAY#<yyyy-mm-dd>   requests created per day
 * They are updated in the same transaction as the request write, so they cannot drift.
 */
type TransactItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

const bump = (PK: string, SK: string, by: number): TransactItem => ({
  Update: {
    TableName: TABLE,
    Key: { PK, SK },
    UpdateExpression: "ADD #c :by",
    ExpressionAttributeNames: { "#c": "count" },
    ExpressionAttributeValues: { ":by": by },
  },
});

export const statsOnCreate = (r: Item): TransactItem[] => {
  const items = [bump("STATS#GLOBAL", `STATUS#${r.status}`, 1), bump(`STATS#MONTH#${monthOf(r.createdAt)}`, `DAY#${dayOf(r.createdAt)}`, 1)];
  if (r.category) items.push(bump("STATS#GLOBAL", `CATEGORY#${r.category}`, 1));
  return items;
};

export const statsOnCategoryChange = (from?: string, to?: string): TransactItem[] => {
  if (from === to) return [];
  const items: TransactItem[] = [];
  if (from) items.push(bump("STATS#GLOBAL", `CATEGORY#${from}`, -1));
  if (to) items.push(bump("STATS#GLOBAL", `CATEGORY#${to}`, 1));
  return items;
};

/** Used by later steps when the status changes (kept here so stats logic lives in one place). */
export const statsOnStatusChange = (from: string, to: string): TransactItem[] =>
  from === to ? [] : [bump("STATS#GLOBAL", `STATUS#${from}`, -1), bump("STATS#GLOBAL", `STATUS#${to}`, 1)];

/* ---------- Reads ---------- */
export const ownerRequests = (ownerId: string): Promise<Item[]> =>
  queryAll(
    {
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :p",
      ExpressionAttributeValues: { ":p": `OWNER#${ownerId}` },
      ScanIndexForward: false,
    },
    2000,
  );

export interface Counts {
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
}

const inc = (m: Record<string, number>, k: string, by = 1) => {
  m[k] = (m[k] ?? 0) + by;
};

export const countsFromItems = (items: Item[]): Counts => {
  const c: Counts = { byStatus: {}, byCategory: {} };
  for (const r of items) {
    inc(c.byStatus, r.status);
    if (r.category) inc(c.byCategory, r.category);
  }
  return c;
};

export const globalCounts = async (): Promise<Counts> => {
  const rows = await queryAll({ KeyConditionExpression: "PK = :p", ExpressionAttributeValues: { ":p": "STATS#GLOBAL" } });
  const c: Counts = { byStatus: {}, byCategory: {} };
  for (const row of rows) {
    const n = Math.max(0, Number(row.count ?? 0));
    if (row.SK.startsWith("STATUS#")) c.byStatus[row.SK.slice(7)] = n;
    else if (row.SK.startsWith("CATEGORY#")) c.byCategory[row.SK.slice(9)] = n;
  }
  return c;
};

/** Daily creation counts between two dates (inclusive), zero-filled. */
export const dailySeries = async (fromDay: string, toDay: string, source: { all: true } | { items: Item[] }): Promise<{ date: string; count: number }[]> => {
  const days: string[] = [];
  for (let t = Date.parse(`${fromDay}T00:00:00Z`); t <= Date.parse(`${toDay}T00:00:00Z`); t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
  if (days.length > 366) throw badRequest("Range too large (max 366 days)");
  const counts = new Map<string, number>();
  if ("all" in source) {
    const months = [...new Set(days.map((d) => d.slice(0, 7)))];
    const rows = await Promise.all(
      months.map((m) =>
        queryAll({
          KeyConditionExpression: "PK = :p AND SK BETWEEN :a AND :b",
          ExpressionAttributeValues: { ":p": `STATS#MONTH#${m}`, ":a": `DAY#${fromDay}`, ":b": `DAY#${toDay}` },
        }),
      ),
    );
    for (const row of rows.flat()) counts.set(row.SK.slice(4), Math.max(0, Number(row.count ?? 0)));
  } else {
    for (const r of source.items) {
      const d = dayOf(r.createdAt);
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
  }
  return days.map((date) => ({ date, count: counts.get(date) ?? 0 }));
};
