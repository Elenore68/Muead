import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { auditItem } from "../lib/audit";
import { ddb, TABLE, transact, txConditionFailed, type Item } from "../lib/db";
import { conflict, notFound } from "../lib/errors";
import { json, router, type Ctx } from "../lib/http";
import { assertView } from "../lib/members";
import { loadRequest, reqKey, type Status } from "../lib/requests";
import {
  buildEntry,
  entryKey,
  EXECUTION_STATUSES,
  isEntryId,
  listEntries,
  parseEntry,
  parseResolution,
  sortEntries,
  summaryOf,
  toEntryApi,
  validateAddEntry,
  validateResolve,
} from "../lib/activity";

/*
 * TASK 09: activity log (progress notes and issues) of one request. Append-only; an issue can be resolved and reopened.
 * Each write is one transaction with a check that the request is still in an execution stage, and an audit entry.
 */
const CONSISTENT = { consistent: true } as const;
const CHANGED = "The entry or the request changed at the same time. Reload and try again.";

const executionCheck = (requestId: string) => {
  const values: Record<string, string> = {};
  EXECUTION_STATUSES.forEach((s, i) => (values[`:e${i}`] = s));
  return {
    ConditionCheck: {
      TableName: TABLE,
      Key: reqKey(requestId),
      ConditionExpression: `attribute_exists(PK) AND #s IN (${EXECUTION_STATUSES.map((_, i) => `:e${i}`).join(", ")})`,
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: values,
    },
  };
};

const list = async ({ caller, path }: Ctx) => {
  const r = await loadRequest(path.requestId);
  await assertView(r, caller);
  const items = sortEntries(await listEntries(r.id));
  return json(200, { items: items.map(toEntryApi), summary: summaryOf(items), requestStatus: r.status });
};

const add = async ({ caller, path, body }: Ctx) => {
  const input = parseEntry(body);
  const r = await loadRequest(path.requestId, CONSISTENT);
  const access = await assertView(r, caller, CONSISTENT);
  const existing = await listEntries(r.id, true);
  validateAddEntry({ access, requestStatus: r.status as Status, existing: existing.length });
  const entry = buildEntry({ requestId: r.id, input, actor: caller, role: access.auditRole, now: new Date().toISOString() });
  const actor = { userId: caller.userId, displayName: caller.displayName, activityRole: access.auditRole };
  try {
    await transact([
      { Put: { TableName: TABLE, Item: entry, ConditionExpression: "attribute_not_exists(PK)" } },
      executionCheck(r.id),
      {
        Put: {
          TableName: TABLE,
          Item: auditItem(r.id, actor, input.type === "ISSUE" ? "ISSUE_REPORTED" : "ACTIVITY_NOTE_ADDED", {
            entryId: entry.id,
            severity: input.severity,
            // The text is not copied into the audit entry or the notification.
          }),
        },
      },
    ]);
  } catch (e) {
    if (txConditionFailed(e)) throw conflict("CONCURRENT_UPDATE", CHANGED);
    throw e;
  }
  return json(201, toEntryApi(entry));
};

const resolve = async ({ caller, path, body }: Ctx) => {
  const patch = parseResolution(body);
  const r = await loadRequest(path.requestId, CONSISTENT);
  const access = await assertView(r, caller, CONSISTENT);
  if (!isEntryId(path.entryId)) throw notFound("Entry not found");
  const entry = (await ddb.send(new GetCommand({ TableName: TABLE, Key: entryKey(r.id, path.entryId), ConsistentRead: true }))).Item;
  validateResolve({ access, requestStatus: r.status as Status, entry });
  if (patch.version !== entry!.version) throw conflict("VERSION_CONFLICT", "The entry was changed by someone else. Reload and try again.");
  if (entry!.state === patch.state) throw conflict("ALREADY_IN_STATE", `The issue is already ${patch.state.toLowerCase()}`);

  const now = new Date().toISOString();
  const next: Item = { ...entry, state: patch.state, version: entry!.version + 1 };
  if (patch.state === "RESOLVED") Object.assign(next, { resolutionNote: patch.note, resolvedBy: caller.userId, resolvedByName: caller.displayName, resolvedAt: now });
  else for (const k of ["resolutionNote", "resolvedBy", "resolvedByName", "resolvedAt"]) delete next[k];
  try {
    await transact([
      {
        Put: {
          TableName: TABLE,
          Item: next,
          ConditionExpression: "attribute_exists(PK) AND #v = :v",
          ExpressionAttributeNames: { "#v": "version" },
          ExpressionAttributeValues: { ":v": entry!.version },
        },
      },
      executionCheck(r.id),
      {
        Put: {
          TableName: TABLE,
          Item: auditItem(r.id, { userId: caller.userId, displayName: caller.displayName, activityRole: access.auditRole }, patch.state === "RESOLVED" ? "ISSUE_RESOLVED" : "ISSUE_REOPENED", {
            entryId: entry!.id,
            severity: entry!.severity,
            reportedBy: entry!.authorId,
          }),
        },
      },
    ]);
  } catch (e) {
    if (txConditionFailed(e)) throw conflict("CONCURRENT_UPDATE", CHANGED);
    throw e;
  }
  return json(200, toEntryApi(next));
};

export const handler = router({
  "GET /requests/{requestId}/activity": list,
  "POST /requests/{requestId}/activity": add,
  "PATCH /requests/{requestId}/activity/{entryId}": resolve,
});
