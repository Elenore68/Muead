import { TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ulid } from "ulid";
import { initialsOf, requireRole } from "../lib/auth";
import { ddb, queryPage, TABLE, type Item } from "../lib/db";
import { ApiError, badRequest, conflict } from "../lib/errors";
import { decodeToken, encodeToken, json, parseLimit, router, type Ctx } from "../lib/http";
import {
  assertEdit,
  assertView,
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

const audit = (requestId: string, actorId: string, action: string, extra: Item = {}): Item => {
  const now = new Date().toISOString();
  return { PK: `REQ#${requestId}`, SK: `AUDIT#${now}#${ulid()}`, entityType: "AUDIT", actorId, action, at: now, ...extra };
};

const isTxConflict = (e: any, index = 0): boolean =>
  e?.name === "TransactionCanceledException" && e.CancellationReasons?.[index]?.Code === "ConditionalCheckFailed";

/* ------------------------------------------------------------------ POST /requests */
const createRequest = async ({ caller, body }: Ctx) => {
  requireRole(caller, "MaintenanceOwner");
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

  const item: Item = {
    ...reqKey(id),
    entityType: "REQUEST",
    id,
    requestNo: `REQ-${String(seq).padStart(4, "0")}`,
    ...f,
    status: "DRAFT",
    approvalState: "NONE",
    ownerId: caller.userId,
    ownerName: caller.displayName,
    ownerInitials: initialsOf(caller.displayName),
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  Object.assign(item, indexAttrs(item));

  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        { Put: { TableName: TABLE, Item: item, ConditionExpression: "attribute_not_exists(PK)" } },
        { Put: { TableName: TABLE, Item: audit(id, caller.userId, "REQUEST_CREATED") } },
        ...statsOnCreate(item),
      ],
    }),
  );
  return json(201, toApi(item), { Location: `/v1/requests/${id}` });
};

/* ------------------------------------------------------------------ GET /requests */
interface Partition {
  index: "GSI1" | "GSI2";
  pk: string;
  forward: boolean;
}

const listRequests = async ({ caller, query }: Ctx) => {
  const limit = parseLimit(query.limit);
  const statusFilter = query.status ? query.status.split(",").map((s) => s.trim().toUpperCase()) : [];
  for (const s of statusFilter) if (!(STATUSES as readonly string[]).includes(s)) throw badRequest(`Unknown status "${s}"`, [{ field: "status", issue: "enum" }]);
  if (query.priority && !(PRIORITIES as readonly string[]).includes(query.priority)) throw badRequest("Unknown priority", [{ field: "priority", issue: "enum" }]);
  if (query.mine && !["owner", "participant", "approver"].includes(query.mine)) throw badRequest("mine must be owner, participant or approver");
  if (query.mine === "participant" || query.mine === "approver") {
    throw new ApiError(501, "NOT_IMPLEMENTED", `mine=${query.mine} arrives with participants and approvals (implementation steps 3-4)`);
  }
  for (const k of ["from", "to"] as const) if (query[k] && Number.isNaN(Date.parse(query[k]))) throw badRequest(`${k} must be an ISO-8601 date`);

  // Which partition(s) to read.
  let partitions: Partition[];
  const ownerId = query.ownerId ?? (query.mine === "owner" || !caller.isAdmin ? caller.userId : undefined);
  if (ownerId && ownerId !== caller.userId && !caller.isAdmin) throw new ApiError(403, "FORBIDDEN", "You can only list your own requests");
  if (ownerId) {
    partitions = [{ index: "GSI1", pk: `OWNER#${ownerId}`, forward: false }];
  } else {
    const statuses = statusFilter.length ? statusFilter : [...STATUSES];
    partitions = statuses.map((s) => ({ index: "GSI2", pk: `STATUS#${s}`, forward: true }));
  }

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
  if (i < 0 || i > partitions.length) throw badRequest("Invalid nextToken");

  const items: Item[] = [];
  let next: { i: number; k: Record<string, unknown> } | undefined;
  while (i < partitions.length && items.length < limit) {
    const p = partitions[i];
    const page = await queryPage(
      {
        IndexName: p.index,
        KeyConditionExpression: `${p.index}PK = :p`,
        ExpressionAttributeValues: { ":p": p.pk },
        ScanIndexForward: p.forward,
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
const requestCounts = async ({ caller, query }: Ctx) => {
  const useAll = caller.isAdmin && query.mine !== "owner";
  const counts = useAll ? await globalCounts() : countsFromItems(await ownerRequests(caller.userId));
  const all = Object.values(counts.byStatus).reduce((a, b) => a + b, 0);
  return json(200, { all, byStatus: counts.byStatus });
};

/* ------------------------------------------------------------------ GET /requests/{id} */
const getRequest = async ({ caller, path }: Ctx) => {
  const r = await loadRequest(path.requestId);
  assertView(r, caller);
  return json(200, toApi(r));
};

/* ------------------------------------------------------------------ PATCH /requests/{id} */
const patchRequest = async ({ caller, path, body }: Ctx) => {
  const r = await loadRequest(path.requestId);
  assertEdit(r, caller);

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
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: TABLE,
              Item: next,
              ConditionExpression: "#v = :v AND attribute_exists(PK)",
              ExpressionAttributeNames: { "#v": "version" },
              ExpressionAttributeValues: { ":v": r.version },
            },
          },
          { Put: { TableName: TABLE, Item: audit(r.id, caller.userId, "REQUEST_UPDATED", { changedFields: Object.keys(f) }) } },
          ...statsOnCategoryChange(r.category, next.category),
        ],
      }),
    );
  } catch (e) {
    if (isTxConflict(e)) throw conflict("VERSION_CONFLICT", "The request was changed by someone else. Reload and try again.");
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
