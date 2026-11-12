import { queryAll, type Item } from "../lib/db";
import { badRequest, forbidden } from "../lib/errors";
import { json, router, type Ctx } from "../lib/http";
import { IN_PROGRESS_STATUSES, monthOf, toSummary } from "../lib/requests";
import { countsFromItems, dailySeries, globalCounts, ownerRequests } from "../lib/stats";
import type { Caller } from "../lib/auth";

/** scope=mine (default) = requests I own. scope=all = everything; platform admins and approvers only. */
const resolveScope = (c: Caller, raw: string | undefined): "mine" | "all" => {
  if (raw === undefined || raw === "mine") return "mine";
  if (raw !== "all") throw badRequest("scope must be mine or all", [{ field: "scope", issue: "enum" }]);
  if (!c.isAdmin && !c.roles.includes("Approver")) throw forbidden("scope=all requires the Approver or PlatformAdmin role");
  return "all";
};

const summary = async ({ caller, query }: Ctx) => {
  const scope = resolveScope(caller, query.scope);
  const counts = scope === "all" ? await globalCounts() : countsFromItems(await ownerRequests(caller.userId));
  const n = (s: string) => counts.byStatus[s] ?? 0;
  const total = Object.values(counts.byStatus).reduce((a, b) => a + b, 0);
  return json(200, {
    scope,
    totals: {
      total,
      pendingApprovals: n("PENDING_APPROVAL"),
      inProgress: IN_PROGRESS_STATUSES.reduce((a, s) => a + n(s), 0),
      completed: n("COMPLETED"),
    },
    byStatus: Object.entries(counts.byStatus).map(([status, count]) => ({ status, count })),
    byCategory: Object.entries(counts.byCategory)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
  });
};

const DAY = /^\d{4}-\d{2}-\d{2}/;

const requestsOverTime = async ({ caller, query }: Ctx) => {
  const scope = resolveScope(caller, query.scope);
  if (query.interval && query.interval !== "day") throw badRequest("Only interval=day is supported");
  const today = new Date().toISOString().slice(0, 10);
  const to = (query.to ?? today).slice(0, 10);
  const from = (query.from ?? new Date(Date.parse(`${to}T00:00:00Z`) - 13 * 86_400_000).toISOString()).slice(0, 10);
  if (!DAY.test(from) || !DAY.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) throw badRequest("from/to must be dates (YYYY-MM-DD)");
  if (from > to) throw badRequest("from must be on or before to");
  const points = await dailySeries(from, to, scope === "all" ? { all: true } : { items: await ownerRequests(caller.userId) });
  return json(200, { points });
};

const NOT_UPCOMING = ["DRAFT", "REJECTED", "CANCELLED", "COMPLETED"];

const upcoming = async ({ caller, query }: Ctx) => {
  const intParam = (name: string, def: number, min: number, max: number) => {
    if (query[name] === undefined) return def;
    const v = Number(query[name]);
    if (!Number.isInteger(v) || v < min || v > max) throw badRequest(`${name} must be an integer between ${min} and ${max}`);
    return v;
  };
  const days = intParam("days", 14, 1, 90);
  const limit = intParam("limit", 5, 1, 50);

  const start = new Date();
  const end = new Date(start.getTime() + days * 86_400_000);
  const months: string[] = [];
  for (let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)); d <= end; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    months.push(monthOf(d.toISOString()));
  }
  const pages = await Promise.all(
    months.map((m) =>
      queryAll({
        IndexName: "GSI3",
        KeyConditionExpression: "GSI3PK = :p AND GSI3SK BETWEEN :a AND :b",
        ExpressionAttributeValues: { ":p": `SCHED#${m}`, ":a": start.toISOString(), ":b": `${end.toISOString()}~` },
      }),
    ),
  );
  const items = pages
    .flat()
    .filter((r: Item) => !NOT_UPCOMING.includes(r.status) && !r.archived && (caller.isAdmin || r.ownerId === caller.userId))
    .sort((a, b) => String(a.scheduleStart).localeCompare(String(b.scheduleStart)))
    .slice(0, limit);
  return json(200, {
    items: items.map((r) => {
      const s = toSummary(r);
      return { requestId: s.id, requestNo: s.requestNo, title: s.title, start: r.scheduleStart, end: r.scheduleEnd ?? null, status: s.status };
    }),
  });
};

export const handler = router({
  "GET /dashboard/summary": summary,
  "GET /dashboard/requests-over-time": requestsOverTime,
  "GET /dashboard/upcoming": upcoming,
});
