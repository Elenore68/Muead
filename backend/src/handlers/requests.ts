import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ulid } from "ulid";
import { initialsOf } from "../lib/auth";
import { auditItem } from "../lib/audit";
import { batchGet, ddb, itemKey, queryPage, TABLE, transact, txConditionFailed, type Item } from "../lib/db";
import { ApiError, badRequest, conflict } from "../lib/errors";
import { assertTokenPartition, decodeToken, encodeToken, json, parseLimit, router, type Ctx } from "../lib/http";
import { assertEdit, assertView, buildMember, memberRequests, type ActivityRole } from "../lib/members";
import {
  EDITABLE_STATUSES,
  indexAttrs,
  loadRequest,
  parseFields,
  PRIORITIES,
  reqKey,
  STATUSES,
  toApi,
  toSummary,
  type Status,
} from "../lib/requests";
import { countsFromItems, globalCounts, ownerRequests, statsOnCategoryChange, statsOnCreate } from "../lib/stats";

/* ------------------------------------------------------------------ POST /requests */
/** Decision 1: any active authenticated user can create a request and becomes its OWNER. */
const createRequest = async ({ caller, body }: Ctx) => {
  const f = parseFields(body, "create");

  // Human-friendly sequential number (database-design.md 3.14).
  const counter = await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: "COUNTER#REQ", SK: "SEQ" },
      UpdateExpression: "ADD seq :one",
      ExpressionAttributeValues: { ":one": 1 },
      ReturnValues: "UPDATED_NEW",
    }),
  );
  const seq = Number(counter.Attributes?.seq);
  const now = new Date().toISOString();
  const id = ulid();
  const me = { userId: caller.userId, displayName: caller.displayName, initials: initialsOf(caller.displayName) };

  const item: Item = {
    ...reqKey(id),
    entityType: "REQUEST",
    id,
    requestNo: `REQ-${String(seq).padStart(4, "0")}`,
    ...f,
    approvalPolicy: f.approvalPolicy ?? "ANY_ONE",
    approvalRound: 0,
    status: "DRAFT",
    approvalState: "NONE",
    ownerId: me.userId,
    ownerName: me.displayName,
    ownerInitials: me.initials,
    membersRev: 0,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  Object.assign(item, indexAttrs(item));
  const owner = buildMember({ request: item, user: me, role: "OWNER", assignedBy: me, assignedByRole: "OWNER", now });

  await transact([
    { Put: { TableName: TABLE, Item: item, ConditionExpression: "attribute_not_exists(PK)" } },
    { Put: { TableName: TABLE, Item: owner, ConditionExpression: "attribute_not_exists(PK)" } },
    { Put: { TableName: TABLE, Item: auditItem(id, { ...me, activityRole: "OWNER" }, "REQUEST_CREATED") } },
    ...statsOnCreate(item),
  ]);
  return json(201, toApi(item), { Location: `/v1/requests/${id}` });
};

/* ------------------------------------------------------------------ GET /requests */
type Source =
  | { kind: "index"; index: "GSI1" | "GSI2"; pk: string; forward: boolean }
  /** Requests the caller is an ACTIVE member of (optionally one activity role). */
  | { kind: "membership"; userId: string; role?: ActivityRole };

/** Pages through the caller's membership index and resolves request items in batches. */
const membershipPage = async (
  userId: string,
  role: ActivityRole | undefined,
  limit: number,
  startKey: Record<string, unknown> | undefined,
  matches: (r: Item) => boolean,
): Promise<{ items: Item[]; lastKey?: Record<string, unknown> }> => {
  const items: Item[] = [];
  let key = startKey;
  for (let rounds = 0; rounds < 20; rounds++) {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :p",
        FilterExpression: role ? "#st = :a AND activityRole = :r" : "#st = :a",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: { ":p": `MEMBER#${userId}`, ":a": "ACTIVE", ...(role ? { ":r": role } : {}) },
        ScanIndexForward: false, // newest request first
        Limit: 50,
        ExclusiveStartKey: key,
      }),
    );
    const members = (res.Items as Item[]) ?? [];
    const reqs = await batchGet(members.map((m) => reqKey(m.requestId)));
    for (const m of members) {
      const r = reqs.get(`REQ#${m.requestId}|META`);
      if (!r || !matches(r)) continue;
      items.push(r);
      if (items.length === limit) return { items, lastKey: itemKey(m, "GSI1") };
    }
    key = res.LastEvaluatedKey;
    if (!key) return { items };
  }
  return { items, lastKey: key };
};

const MINE = { owner: "OWNER", participant: "PARTICIPANT", approver: "APPROVER" } as const;

const listRequests = async ({ caller, query }: Ctx) => {
  const limit = parseLimit(query.limit);
  const statusFilter = query.status ? query.status.split(",").map((s) => s.trim().toUpperCase()) : [];
  for (const s of statusFilter) if (!(STATUSES as readonly string[]).includes(s)) throw badRequest(`Unknown status "${s}"`, [{ field: "status", issue: "enum" }]);
  if (query.priority && !(PRIORITIES as readonly string[]).includes(query.priority)) throw badRequest("Unknown priority", [{ field: "priority", issue: "enum" }]);
  if (query.mine && !(query.mine in MINE)) throw badRequest("mine must be owner, participant or approver", [{ field: "mine", issue: "enum" }]);
  for (const k of ["from", "to"] as const) if (query[k] && Number.isNaN(Date.parse(query[k]))) throw badRequest(`${k} must be an ISO-8601 date`);
  if (query.ownerId && !caller.isAdmin) throw new ApiError(403, "FORBIDDEN", "Only platform admins can filter by another owner");

  // Which source(s) to read.
  //  - platform admin, no filter      -> every request (status partitions)        [read-only global access]
  //  - ownerId (admin) / mine=owner   -> owner index
  //  - mine=participant|approver      -> membership index, that role
  //  - everyone else                  -> membership index, all roles (owner, participant, approver)
  let sources: Source[];
  if (query.ownerId) sources = [{ kind: "index", index: "GSI1", pk: `OWNER#${query.ownerId}`, forward: false }];
  else if (query.mine === "owner") sources = [{ kind: "index", index: "GSI1", pk: `OWNER#${caller.userId}`, forward: false }];
  else if (query.mine) sources = [{ kind: "membership", userId: caller.userId, role: MINE[query.mine as keyof typeof MINE] }];
  else if (caller.isAdmin) {
    const statuses = statusFilter.length ? statusFilter : [...STATUSES];
    sources = statuses.map((s) => ({ kind: "index", index: "GSI2", pk: `STATUS#${s}`, forward: true }));
  } else sources = [{ kind: "membership", userId: caller.userId }];

  const q = query.q?.trim().toLowerCase();
  const matches = (r: Item): boolean => {
    if (r.archived) return false;
    if (statusFilter.length && !statusFilter.includes(r.status)) return false;
    if (query.category && r.category !== query.category) return false;
    if (query.priority && r.priority !== query.priority) return false;
    const when: string = r.scheduleStart ?? r.createdAt;
    if (query.from && when < new Date(query.from).toISOString()) return false;
    if (query.to && when > new Date(query.to).toISOString()) return false;
    if (q && !`${r.title} ${r.requestNo}`.toLowerCase().includes(q)) return false;
    return true;
  };

  const tok = decodeToken(query.nextToken) as { i?: number; k?: Record<string, unknown> } | undefined;
  let i = typeof tok?.i === "number" ? tok.i : 0;
  let startKey = tok?.k;
  if (!Number.isInteger(i) || i < 0 || i >= Math.max(sources.length, 1) || (startKey !== undefined && (typeof startKey !== "object" || startKey === null))) {
    throw badRequest("Invalid nextToken");
  }
  // The continuation key must belong to the partition this source reads (a token from another mode or user -> 400).
  if (startKey) {
    const s = sources[i];
    if (s.kind === "membership") assertTokenPartition(startKey, "GSI1PK", `MEMBER#${s.userId}`);
    else assertTokenPartition(startKey, `${s.index}PK`, s.pk);
  }

  const items: Item[] = [];
  let next: { i: number; k: Record<string, unknown> } | undefined;
  while (i < sources.length && items.length < limit) {
    const s = sources[i];
    const page =
      s.kind === "membership"
        ? await membershipPage(s.userId, s.role, limit - items.length, startKey, matches)
        : await queryPage(
            {
              IndexName: s.index,
              KeyConditionExpression: `${s.index}PK = :p`,
              ExpressionAttributeValues: { ":p": s.pk },
              ScanIndexForward: s.forward,
              ExclusiveStartKey: startKey,
            },
            limit - items.length,
            matches,
          );
    items.push(...page.items);
    if (page.lastKey) {
      next = { i, k: page.lastKey };
      break;
    }
    i++;
    startKey = undefined;
  }
  return json(200, { items: items.map(toSummary), nextToken: encodeToken(next) });
};

/* ------------------------------------------------------------------ GET /requests/counts */
/** Same scope as GET /requests: admins (no mine) = global aggregates; otherwise the caller's memberships. */
const requestCounts = async ({ caller, query }: Ctx) => {
  if (query.mine && !(query.mine in MINE)) throw badRequest("mine must be owner, participant or approver", [{ field: "mine", issue: "enum" }]);
  let counts;
  if (caller.isAdmin && !query.mine) counts = await globalCounts();
  else if (query.mine === "owner") counts = countsFromItems(await ownerRequests(caller.userId));
  else counts = countsFromItems(await memberRequests(caller.userId, query.mine ? MINE[query.mine as keyof typeof MINE] : undefined));
  const all = Object.values(counts.byStatus).reduce((a, b) => a + b, 0);
  return json(200, { all, byStatus: counts.byStatus });
};

/* ------------------------------------------------------------------ GET /requests/{id} */
const getRequest = async ({ caller, path }: Ctx) => {
  const r = await loadRequest(path.requestId);
  const access = await assertView(r, caller);
  return json(200, {
    ...toApi(r),
    // What the caller may do here; the backend enforces it again on every call.
    viewer: { activityRole: access.role ?? null, canEdit: access.canEdit, canManageMembers: access.canManageMembers },
  });
};

/* ------------------------------------------------------------------ PATCH /requests/{id} */
const patchRequest = async ({ caller, path, body }: Ctx) => {
  const r = await loadRequest(path.requestId);
  const access = await assertEdit(r, caller);

  if (typeof body.version !== "number" || !Number.isInteger(body.version)) {
    throw badRequest("version is required", [{ field: "version", issue: "required" }]);
  }
  if (body.version !== r.version) throw conflict("VERSION_CONFLICT", "The request was changed by someone else. Reload and try again.");
  if (!EDITABLE_STATUSES.includes(r.status as Status)) {
    throw new ApiError(400, "INVALID_TRANSITION", `A request in status ${r.status} cannot be edited`);
  }

  const f = parseFields(body, "patch");
  if (Object.keys(f).length === 0) throw badRequest("Nothing to update");

  const now = new Date().toISOString();
  const { GSI1PK, GSI1SK, GSI2PK, GSI2SK, GSI3PK, GSI3SK, ...base } = r;
  const next: Item = { ...base, ...f, updatedAt: now, version: r.version + 1 };
  if (next.scheduleEnd && next.scheduleStart && Date.parse(next.scheduleEnd) <= Date.parse(next.scheduleStart)) {
    throw badRequest("schedule.end must be after schedule.start", [{ field: "schedule.end", issue: "order" }]);
  }
  Object.assign(next, indexAttrs(next));

  try {
    await transact([
      {
        Put: {
          TableName: TABLE,
          Item: next,
          ConditionExpression: "#v = :v AND attribute_exists(PK)",
          ExpressionAttributeNames: { "#v": "version" },
          ExpressionAttributeValues: { ":v": r.version },
        },
      },
      {
        Put: {
          TableName: TABLE,
          Item: auditItem(r.id, { userId: caller.userId, displayName: caller.displayName, activityRole: access.auditRole }, "REQUEST_UPDATED", {
            changedFields: Object.keys(f),
          }),
        },
      },
      ...statsOnCategoryChange(r.category, next.category),
    ]);
  } catch (e) {
    if (txConditionFailed(e, 0)) throw conflict("VERSION_CONFLICT", "The request was changed by someone else. Reload and try again.");
    throw e;
  }
  return json(200, toApi(next));
};

export const handler = router({
  "GET /requests": listRequests,
  "POST /requests": createRequest,
  "GET /requests/counts": requestCounts,
  "GET /requests/{requestId}": getRequest,
  "PATCH /requests/{requestId}": patchRequest,
});
