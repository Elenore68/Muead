import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchGetCommand,
  BatchWriteCommand,
  DynamoDBDocumentClient,
  QueryCommand,
  TransactWriteCommand,
  type QueryCommandInput,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { ApiError } from "./errors";

export const TABLE = process.env.TABLE_NAME ?? "";

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export type Item = Record<string, any>;
export type TransactItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

/** DynamoDB hard limit for one TransactWriteItems call. */
export const MAX_TRANSACTION_ITEMS = 100;

/**
 * Sends one atomic transaction. Refuses (instead of letting DynamoDB fail) when the item count is above the limit,
 * so callers must keep their own caps (for example MAX_APPROVERS) well below it.
 */
export const transact = async (items: TransactItem[]): Promise<void> => {
  if (items.length === 0) return;
  if (items.length > MAX_TRANSACTION_ITEMS) {
    throw new ApiError(500, "TRANSACTION_TOO_LARGE", `Internal limit exceeded (${items.length} > ${MAX_TRANSACTION_ITEMS} items)`);
  }
  await ddb.send(new TransactWriteCommand({ TransactItems: items }));
};

/** True when a transaction was cancelled because the condition of item `index` failed (any item if omitted). */
export const txConditionFailed = (e: any, index?: number): boolean => {
  if (e?.name !== "TransactionCanceledException") return false;
  const reasons: { Code?: string }[] = e.CancellationReasons ?? [];
  return index === undefined ? reasons.some((r) => r?.Code === "ConditionalCheckFailed") : reasons[index]?.Code === "ConditionalCheckFailed";
};

/** Runs a query and follows pages until `max` items are collected (or the index is exhausted). */
export const queryAll = async (input: Omit<QueryCommandInput, "TableName">, max = 1000): Promise<Item[]> => {
  const out: Item[] = [];
  let key: Record<string, any> | undefined = input.ExclusiveStartKey;
  do {
    const res = await ddb.send(new QueryCommand({ ...input, TableName: TABLE, ExclusiveStartKey: key }));
    out.push(...((res.Items as Item[]) ?? []));
    key = res.LastEvaluatedKey;
  } while (key && out.length < max);
  return out.slice(0, max);
};

/** Exact item count for a key condition (Select COUNT; follows pages). */
export const queryCount = async (input: Omit<QueryCommandInput, "TableName" | "Select">): Promise<number> => {
  let n = 0;
  let key: Record<string, any> | undefined;
  do {
    const res = await ddb.send(new QueryCommand({ ...input, TableName: TABLE, Select: "COUNT", ExclusiveStartKey: key }));
    n += res.Count ?? 0;
    key = res.LastEvaluatedKey;
  } while (key);
  return n;
};

/**
 * Gets many items by primary key (chunks of 100, retries unprocessed keys with backoff).
 * Returns a map keyed by `${PK}|${SK}`; missing items are simply absent.
 */
export const batchGet = async (keys: { PK: string; SK: string }[]): Promise<Map<string, Item>> => {
  const out = new Map<string, Item>();
  const unique = [...new Map(keys.map((k) => [`${k.PK}|${k.SK}`, k])).values()];
  for (let i = 0; i < unique.length; i += 100) {
    let pending: Record<string, any>[] = unique.slice(i, i + 100);
    for (let attempt = 0; pending.length && attempt < 5; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
      const res = await ddb.send(new BatchGetCommand({ RequestItems: { [TABLE]: { Keys: pending } } }));
      for (const it of (res.Responses?.[TABLE] as Item[]) ?? []) out.set(`${it.PK}|${it.SK}`, it);
      pending = (res.UnprocessedKeys?.[TABLE]?.Keys as Record<string, any>[]) ?? [];
    }
    if (pending.length) throw new ApiError(503, "UPSTREAM_UNAVAILABLE", "The database is busy. Please try again.");
  }
  return out;
};

/**
 * BatchWriteItem in chunks of 25, retrying `UnprocessedItems` with backoff.
 * Throws instead of silently dropping writes (TASK 04a review, finding I6).
 */
export const batchWriteAll = async (requests: Record<string, unknown>[]): Promise<void> => {
  for (let i = 0; i < requests.length; i += 25) {
    let pending: Record<string, unknown>[] = requests.slice(i, i + 25);
    for (let attempt = 0; pending.length && attempt < 5; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
      const res = await ddb.send(new BatchWriteCommand({ RequestItems: { [TABLE]: pending as any } }));
      pending = (res.UnprocessedItems?.[TABLE] as Record<string, unknown>[] | undefined) ?? [];
    }
    if (pending.length) throw new ApiError(503, "UPSTREAM_UNAVAILABLE", "The database is busy. Please try again.");
  }
};

/** Fetches filtered pages until `limit` matches are found; returns the continuation key. */
export const queryPage = async (
  input: Omit<QueryCommandInput, "TableName" | "Limit">,
  limit: number,
  filter: (item: Item) => boolean,
): Promise<{ items: Item[]; lastKey?: Record<string, any> }> => {
  const items: Item[] = [];
  let key: Record<string, any> | undefined = input.ExclusiveStartKey;
  let rounds = 0;
  while (rounds++ < 20) {
    const res = await ddb.send(new QueryCommand({ ...input, TableName: TABLE, ExclusiveStartKey: key, Limit: Math.max(limit, 25) }));
    for (const it of (res.Items as Item[]) ?? []) {
      if (!filter(it)) continue;
      items.push(it);
      if (items.length === limit) {
        // Resume right after the last returned item.
        return { items, lastKey: itemKey(it, input.IndexName) };
      }
    }
    key = res.LastEvaluatedKey;
    if (!key) return { items };
  }
  return { items, lastKey: key };
};

/** Primary key (+ index keys) of an item, used as ExclusiveStartKey. */
export const itemKey = (it: Item, indexName?: string): Record<string, any> => {
  const k: Record<string, any> = { PK: it.PK, SK: it.SK };
  if (indexName) {
    k[`${indexName}PK`] = it[`${indexName}PK`];
    k[`${indexName}SK`] = it[`${indexName}SK`];
  }
  return k;
};
