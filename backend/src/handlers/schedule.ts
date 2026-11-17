import { batchGet, queryAll, type Item } from "../lib/db";
import { badRequest } from "../lib/errors";
import { json, router, type Ctx } from "../lib/http";
import { assertView, listMembers, memberKey } from "../lib/members";
import { loadRequest, toSummary } from "../lib/requests";
import { conflictReasons, isActiveForConflicts, MAX_CANDIDATES, MAX_RANGE_DAYS, monthsFor, windowOf, overlaps, type Reason } from "../lib/schedule";

/*
 * TASK 12: the schedule (SOW 4.4) and conflict warnings. Conflicts are warnings only, see lib/schedule.ts for the rules.
 * Other people's activities are never revealed beyond what the caller may see: a conflict with an activity the caller is not
 * part of is reported without its number, title or people.
 */
const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Planned or running activities whose window overlaps [fromMs, toMs). */
const candidatesIn = async (fromMs: number, toMs: number): Promise<Item[]> => {
  const pages = await Promise.all(
    monthsFor(fromMs, toMs).map((m) =>
      queryAll({ IndexName: "GSI3", KeyConditionExpression: "GSI3PK = :p", ExpressionAttributeValues: { ":p": `SCHED#${m}` } }, MAX_CANDIDATES),
    ),
  );
  const seen = new Set<string>();
  return pages
    .flat()
    .filter((r) => {
      const w = windowOf(r);
      if (!w || seen.has(r.id) || !isActiveForConflicts(r)) return false;
      seen.add(r.id);
      return w.start < toMs && fromMs < w.end;
    })
    .slice(0, MAX_CANDIDATES);
};

/** Memoised member lists, so each request is read at most once per call. */
const memberCache = () => {
  const cache = new Map<string, Promise<Item[]>>();
  return (id: string) => {
    if (!cache.has(id)) cache.set(id, listMembers(id));
    return cache.get(id)!;
  };
};

const viewableIds = async (ids: string[], userId: string): Promise<Set<string>> => {
  const got = await batchGet(ids.map((id) => memberKey(id, userId)));
  return new Set(ids.filter((id) => (got.get(`REQ#${id}|MEMBER#${userId}`) as Item | undefined)?.status === "ACTIVE"));
};

/* ------------------------------------------------------------------ GET /requests/{id}/conflicts */
const conflicts = async ({ caller, path }: Ctx) => {
  const r = await loadRequest(path.requestId);
  await assertView(r, caller);
  const w = windowOf(r);
  if (!w) return json(200, { items: [], scheduled: false });
  const membersOf = memberCache();
  const others = (await candidatesIn(w.start, w.end)).filter((o) => o.id !== r.id);
  const found: { other: Item; reasons: Reason[] }[] = [];
  for (const o of others) {
    const reasons = await conflictReasons(r, o, membersOf);
    if (reasons.length) found.push({ other: o, reasons });
  }
  const canSee = caller.isAdmin ? new Set(found.map((f) => f.other.id)) : await viewableIds(found.map((f) => f.other.id), caller.userId);
  return json(200, {
    scheduled: true,
    items: found
      .sort((a, b) => String(a.other.scheduleStart).localeCompare(String(b.other.scheduleStart)))
      .map(({ other, reasons }) => {
        const visible = canSee.has(other.id);
        return {
          restricted: !visible,
          requestId: visible ? other.id : null,
          requestNo: visible ? other.requestNo : null,
          title: visible ? other.title : null,
          status: other.status,
          start: other.scheduleStart,
          end: other.scheduleEnd ?? null,
          environment: other.environment ?? null,
          reasons: reasons.map((x) => ({
            type: x.type,
            systems: visible ? x.systems : undefined,
            people: visible ? x.people : undefined,
            peopleCount: x.people?.length,
          })),
        };
      }),
  });
};

/* ------------------------------------------------------------------ GET /schedule */
const schedule = async ({ caller, query }: Ctx) => {
  const today = new Date().toISOString().slice(0, 10);
  const from = query.from ?? today;
  const to = query.to ?? new Date(Date.parse(`${from}T00:00:00Z`) + 30 * DAY_MS).toISOString().slice(0, 10);
  if (!DATE.test(from) || !DATE.test(to) || Number.isNaN(Date.parse(`${from}T00:00:00Z`)) || Number.isNaN(Date.parse(`${to}T00:00:00Z`))) {
    throw badRequest("from and to must be dates (YYYY-MM-DD)");
  }
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`) + DAY_MS;
  if (toMs <= fromMs) throw badRequest("from must be on or before to");
  if ((toMs - fromMs) / DAY_MS > MAX_RANGE_DAYS) throw badRequest(`The range can be at most ${MAX_RANGE_DAYS} days`);

  const inRange = await candidatesIn(fromMs, toMs);
  const mine = caller.isAdmin ? new Set(inRange.map((r) => r.id)) : await viewableIds(inRange.map((r) => r.id), caller.userId);
  const visible = inRange.filter((r) => mine.has(r.id)).sort((a, b) => String(a.scheduleStart).localeCompare(String(b.scheduleStart)));

  // Conflicts are counted against EVERY planned activity in the range, but only the count is returned.
  const membersOf = memberCache();
  const items = [];
  for (const r of visible) {
    let n = 0;
    for (const o of inRange) if (o.id !== r.id && overlaps(r, o) && (await conflictReasons(r, o, membersOf)).length) n++;
    const s = toSummary(r);
    items.push({
      requestId: s.id,
      requestNo: s.requestNo,
      title: s.title,
      status: s.status,
      start: r.scheduleStart,
      end: r.scheduleEnd ?? null,
      environment: r.environment ?? null,
      owner: s.owner,
      conflictCount: n,
    });
  }
  return json(200, { from, to, items, conflicts: items.filter((i) => i.conflictCount > 0).length, truncated: inRange.length >= MAX_CANDIDATES });
};

export const handler = router({
  "GET /schedule": schedule,
  "GET /requests/{requestId}/conflicts": conflicts,
});
