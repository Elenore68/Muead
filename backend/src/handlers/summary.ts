import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { auditItem } from "../lib/audit";
import { aiConfigFromEnv, AI_DISABLED, bedrockGenerator, buildPrompt, MAX_SUMMARY_TEXT, parseLanguage, type Generator } from "../lib/ai";
import { ddb, TABLE, transact, txConditionFailed } from "../lib/db";
import { ApiError, badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { json, router, type Ctx } from "../lib/http";
import { assertView } from "../lib/members";
import { reportKey } from "../lib/report";
import { loadRequest } from "../lib/requests";

/*
 * TASK 11: AI activity summary of a COMPLETED request.
 *   POST .../report/summary/generate  -> a DRAFT from the model (never saved)
 *   PUT  .../report/summary           -> the reviewed text, saved with the reviewer's name and time
 * Both are for the owner or a platform admin.
 */
let generator: Generator = bedrockGenerator;
/** Tests inject a fake model; production uses Bedrock. */
export const setSummaryGenerator = (g: Generator) => {
  generator = g;
};

const loadReport = async (requestId: string) => {
  const item = (await ddb.send(new GetCommand({ TableName: TABLE, Key: reportKey(requestId), ConsistentRead: true }))).Item;
  if (!item) throw notFound("The final report is available once the request is completed");
  return item;
};

const generate = async ({ caller, path, body }: Ctx) => {
  const cfg = aiConfigFromEnv();
  const language = parseLanguage(body.language);
  const r = await loadRequest(path.requestId);
  const access = await assertView(r, caller);
  if (!access.canEdit) throw forbidden("Only the owner of this request or a platform admin can generate its summary");
  if (!cfg.enabled) throw AI_DISABLED();
  const report = await loadReport(r.id);
  let draft: string;
  try {
    draft = await generator(buildPrompt(report, language), cfg.modelId);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    console.error(JSON.stringify({ level: "error", message: "ai summary failed", error: String(e) }));
    throw new ApiError(502, "AI_UNAVAILABLE", "The AI service could not write a summary right now. Try again later or write it yourself.");
  }
  // The draft is trimmed to the saved limit so the reviewer can always save what they see.
  return json(200, { draft: draft.trim().slice(0, MAX_SUMMARY_TEXT), language, model: cfg.modelId, saved: false });
};

const save = async ({ caller, path, body }: Ctx) => {
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) throw badRequest("text is required", [{ field: "text", issue: "required" }]);
  if (text.length > MAX_SUMMARY_TEXT) throw badRequest(`text is too long (max ${MAX_SUMMARY_TEXT})`, [{ field: "text", issue: "max_length" }]);
  if (body.aiAssisted !== undefined && typeof body.aiAssisted !== "boolean") throw badRequest("aiAssisted must be true or false", [{ field: "aiAssisted", issue: "type" }]);
  const language = parseLanguage(body.language);
  const r = await loadRequest(path.requestId, { consistent: true });
  const access = await assertView(r, caller, { consistent: true });
  if (!access.canEdit) throw forbidden("Only the owner of this request or a platform admin can save its summary");
  await loadReport(r.id);

  const now = new Date().toISOString();
  const aiSummary = { text, language, aiAssisted: body.aiAssisted === true, reviewedBy: caller.userId, reviewedByName: caller.displayName, reviewedAt: now };
  try {
    await transact([
      {
        Update: {
          TableName: TABLE,
          Key: reportKey(r.id),
          UpdateExpression: "SET #a = :a",
          ConditionExpression: "attribute_exists(PK)",
          ExpressionAttributeNames: { "#a": "aiSummary" },
          ExpressionAttributeValues: { ":a": aiSummary },
        },
      },
      {
        Put: {
          TableName: TABLE,
          Item: auditItem(r.id, { userId: caller.userId, displayName: caller.displayName, activityRole: access.auditRole }, "SUMMARY_SAVED", { aiAssisted: aiSummary.aiAssisted, language }),
        },
      },
    ]);
  } catch (e) {
    if (txConditionFailed(e)) throw conflict("CONCURRENT_UPDATE", "The report changed. Reload and try again.");
    throw e;
  }
  return json(200, aiSummary);
};

export const handler = router({
  "POST /requests/{requestId}/report/summary/generate": generate,
  "PUT /requests/{requestId}/report/summary": save,
});
