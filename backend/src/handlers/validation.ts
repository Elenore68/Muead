import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { auditItem } from "../lib/audit";
import { ddb, TABLE, transact, txConditionFailed, type Item } from "../lib/db";
import { conflict, notFound } from "../lib/errors";
import { json, router, type Ctx } from "../lib/http";
import { assertView } from "../lib/members";
import { loadRequest, type Status } from "../lib/requests";
import { reportKey, toReportApi } from "../lib/report";
import { DOMAINS, inValidationCheck, listValidation, parseResult, toValidationApi, validateResultUpdate, validationKey, validationProgress } from "../lib/validation";

/*
 * TASK 10: post-maintenance validation results (SOW 4.9) and the final report (SOW 4.10).
 * The closing itself (VALIDATION -> COMPLETED) is a lifecycle transition, see handlers/requests.ts.
 */
const CONSISTENT = { consistent: true } as const;
const CHANGED = "The check or the request changed at the same time. Reload and try again.";

const list = async ({ caller, path }: Ctx) => {
  const r = await loadRequest(path.requestId);
  await assertView(r, caller);
  const items = await listValidation(r.id);
  return json(200, { items: items.map(toValidationApi), progress: validationProgress(items), requestStatus: r.status, started: items.length > 0 });
};

const update = async ({ caller, path, body }: Ctx) => {
  const patch = parseResult(body);
  if (!(DOMAINS as readonly string[]).includes(path.domain)) throw notFound("Validation check not found");
  const r = await loadRequest(path.requestId, CONSISTENT);
  const access = await assertView(r, caller, CONSISTENT);
  const item = (await ddb.send(new GetCommand({ TableName: TABLE, Key: validationKey(r.id, path.domain), ConsistentRead: true }))).Item;
  validateResultUpdate({ access, requestStatus: r.status as Status, item });
  if (patch.version !== item!.version) throw conflict("VERSION_CONFLICT", "The check was changed by someone else. Reload and try again.");

  const now = new Date().toISOString();
  const next: Item = { ...item, result: patch.result, updatedAt: now, updatedBy: caller.userId, updatedByName: caller.displayName, version: item!.version + 1 };
  if (patch.note) next.note = patch.note;
  else delete next.note;

  const actor = { userId: caller.userId, displayName: caller.displayName, activityRole: access.auditRole };
  const others = (await listValidation(r.id, true)).filter((i) => i.domain !== item!.domain);
  const allResolved = patch.result !== "PENDING" && others.every((i) => i.result !== "PENDING");
  const audits = [auditItem(r.id, actor, "VALIDATION_UPDATED", { domain: item!.domain, fromResult: item!.result, toResult: patch.result })];
  // The last open check: tell the owner and participants that validation is complete (reserved notification rule).
  if (allResolved && item!.result === "PENDING") audits.push(auditItem(r.id, actor, "VALIDATION_COMPLETED", { failed: [...others, next].filter((i) => i.result === "FAILED").length }));

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
      inValidationCheck(r.id),
      ...audits.map((Item) => ({ Put: { TableName: TABLE, Item } })),
    ]);
  } catch (e) {
    if (txConditionFailed(e)) throw conflict("CONCURRENT_UPDATE", CHANGED);
    throw e;
  }
  return json(200, toValidationApi(next));
};

/** The report exists only after the request was closed. */
const report = async ({ caller, path }: Ctx) => {
  const r = await loadRequest(path.requestId);
  await assertView(r, caller);
  const item = (await ddb.send(new GetCommand({ TableName: TABLE, Key: reportKey(r.id) }))).Item;
  if (!item) throw notFound("The final report is available once the request is completed");
  return json(200, toReportApi(item));
};

export const handler = router({
  "GET /requests/{requestId}/validation": list,
  "PATCH /requests/{requestId}/validation/{domain}": update,
  "GET /requests/{requestId}/report": report,
});
