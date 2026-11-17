import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { auditItem } from "../lib/audit";
import { ddb, TABLE, transact, txConditionFailed, type Item } from "../lib/db";
import { conflict, notFound } from "../lib/errors";
import { json, router, type Ctx } from "../lib/http";
import { assertView } from "../lib/members";
import { loadRequest, reqKey, type Status } from "../lib/requests";
import {
  buildCustomItem,
  isItemId,
  itemKey,
  listItems,
  parseCustomItem,
  parseItemPatch,
  progressOf,
  sortItems,
  toItemApi,
  validateCustomAdd,
  validateCustomDelete,
  validateItemUpdate,
} from "../lib/readiness";

/*
 * TASK 08: readiness checklist items of one request (SOW 4.6). Each write is one transaction: the item (version condition),
 * a check that the request is still in READINESS, and an audit entry (READINESS_UPDATED notifies the owner).
 */
const CONSISTENT = { consistent: true } as const;
const CHANGED = "The checklist or the request changed at the same time. Reload and try again.";

const loadItem = async (requestId: string, itemId: string): Promise<Item | undefined> => {
  if (!isItemId(itemId)) throw notFound("Checklist item not found");
  return (await ddb.send(new GetCommand({ TableName: TABLE, Key: itemKey(requestId, itemId), ConsistentRead: true }))).Item;
};

/** Fails the transaction unless the request is still in READINESS. */
const inReadinessCheck = (requestId: string) => ({
  ConditionCheck: {
    TableName: TABLE,
    Key: reqKey(requestId),
    ConditionExpression: "attribute_exists(PK) AND #s = :r",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":r": "READINESS" },
  },
});

/* ------------------------------------------------------------------ GET /requests/{id}/readiness */
const list = async ({ caller, path }: Ctx) => {
  const r = await loadRequest(path.requestId);
  await assertView(r, caller);
  const items = sortItems(await listItems(r.id));
  // `editable` lets the UI show controls; the backend re-checks every write.
  return json(200, { items: items.map(toItemApi), progress: progressOf(items), requestStatus: r.status, started: items.length > 0 });
};

/* ------------------------------------------------------------------ PATCH /requests/{id}/readiness/{itemId} */
const update = async ({ caller, path, body }: Ctx) => {
  const patch = parseItemPatch(body);
  const r = await loadRequest(path.requestId, CONSISTENT);
  const access = await assertView(r, caller, CONSISTENT);
  const item = await loadItem(r.id, path.itemId);
  validateItemUpdate({ access, requestStatus: r.status as Status, item });
  if (patch.version !== item!.version) throw conflict("VERSION_CONFLICT", "The item was changed by someone else. Reload and try again.");

  const now = new Date().toISOString();
  const next: Item = { ...item, state: patch.state, updatedAt: now, updatedBy: caller.userId, updatedByName: caller.displayName, version: item!.version + 1 };
  if (patch.note) next.note = patch.note;
  else delete next.note;
  try {
    await transact([
      {
        Put: {
          TableName: TABLE,
          Item: next,
          ConditionExpression: "attribute_exists(PK) AND #v = :v",
          ExpressionAttributeNames: { "#v": "version" },
          ExpressionAttributeValues: { ":v": item!.version },
        },
      },
      inReadinessCheck(r.id),
      {
        Put: {
          TableName: TABLE,
          Item: auditItem(r.id, { userId: caller.userId, displayName: caller.displayName, activityRole: access.auditRole }, "READINESS_UPDATED", {
            itemId: item!.id,
            itemTitle: item!.title,
            group: item!.group,
            fromState: item!.state,
            toState: patch.state,
          }),
        },
      },
    ]);
  } catch (e) {
    if (txConditionFailed(e)) throw conflict("CONCURRENT_UPDATE", CHANGED);
    throw e;
  }
  return json(200, toItemApi(next));
};

/* ------------------------------------------------------------------ POST /requests/{id}/readiness */
const addCustom = async ({ caller, path, body }: Ctx) => {
  const input = parseCustomItem(body);
  const r = await loadRequest(path.requestId, CONSISTENT);
  const access = await assertView(r, caller, CONSISTENT);
  const existing = await listItems(r.id, true);
  validateCustomAdd({ access, requestStatus: r.status as Status, existing });
  const item = buildCustomItem(r.id, input.group, input.title, caller, new Date().toISOString());
  try {
    await transact([
      { Put: { TableName: TABLE, Item: item, ConditionExpression: "attribute_not_exists(PK)" } },
      inReadinessCheck(r.id),
      {
        Put: {
          TableName: TABLE,
          Item: auditItem(r.id, { userId: caller.userId, displayName: caller.displayName, activityRole: access.auditRole }, "READINESS_ITEM_ADDED", {
            itemId: item.id,
            itemTitle: item.title,
            group: item.group,
          }),
        },
      },
    ]);
  } catch (e) {
    if (txConditionFailed(e)) throw conflict("CONCURRENT_UPDATE", CHANGED);
    throw e;
  }
  return json(201, toItemApi(item));
};

/* ------------------------------------------------------------------ DELETE /requests/{id}/readiness/{itemId} */
const remove = async ({ caller, path }: Ctx) => {
  const r = await loadRequest(path.requestId, CONSISTENT);
  const access = await assertView(r, caller, CONSISTENT);
  const item = await loadItem(r.id, path.itemId);
  validateCustomDelete({ access, requestStatus: r.status as Status, item });
  try {
    await transact([
      {
        Delete: {
          TableName: TABLE,
          Key: itemKey(r.id, item!.id),
          ConditionExpression: "attribute_exists(PK) AND #v = :v",
          ExpressionAttributeNames: { "#v": "version" },
          ExpressionAttributeValues: { ":v": item!.version },
        },
      },
      inReadinessCheck(r.id),
      {
        Put: {
          TableName: TABLE,
          Item: auditItem(r.id, { userId: caller.userId, displayName: caller.displayName, activityRole: access.auditRole }, "READINESS_ITEM_DELETED", {
            itemId: item!.id,
            itemTitle: item!.title,
          }),
        },
      },
    ]);
  } catch (e) {
    if (txConditionFailed(e)) throw conflict("CONCURRENT_UPDATE", CHANGED);
    throw e;
  }
  return json(204);
};

export const handler = router({
  "GET /requests/{requestId}/readiness": list,
  "POST /requests/{requestId}/readiness": addCustom,
  "PATCH /requests/{requestId}/readiness/{itemId}": update,
  "DELETE /requests/{requestId}/readiness/{itemId}": remove,
});
