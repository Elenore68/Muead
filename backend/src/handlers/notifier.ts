import type { DynamoDBBatchResponse, DynamoDBStreamEvent } from "aws-lambda";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { batchGet, ddb, queryAll, TABLE, type Item } from "../lib/db";
import { deliverEmail, emailConfigFromEnv, sesSender, type EmailConfig, type EmailSender } from "../lib/email";
import { buildNotification, notificationIdFromAudit, planNotifications, type MemberLite, type RequestLite } from "../lib/notifications";
import { reqKey } from "../lib/requests";
import { userKey } from "../lib/users";

/*
 * Notifier (TASK 05). Triggered by the table's DynamoDB stream, filtered in the event source mapping to
 * INSERTs of AUDIT items. It never runs inside a user request, so a failure here cannot block an approval.
 *
 * Idempotent: the notification id is the audit entry's ULID and each write is conditional on the item not
 * existing, so stream retries never duplicate notifications or reset a notification that was already read.
 */
export const processAudit = async (audit: Item, deps: { email: EmailConfig; sender?: EmailSender; now?: Date }): Promise<number> => {
  if (audit.entityType !== "AUDIT" || typeof audit.PK !== "string" || !audit.PK.startsWith("REQ#")) return 0;
  const id = notificationIdFromAudit(String(audit.SK ?? ""));
  if (!id) return 0;
  const requestId = audit.PK.slice(4);

  // Strongly consistent: membership right after the audited change decides who may be told.
  const [reqRes, members] = await Promise.all([
    ddb.send(new GetCommand({ TableName: TABLE, Key: reqKey(requestId), ConsistentRead: true })),
    queryAll({
      KeyConditionExpression: "PK = :p AND begins_with(SK, :m)",
      ExpressionAttributeValues: { ":p": `REQ#${requestId}`, ":m": "MEMBER#" },
      ConsistentRead: true,
    }),
  ]);
  const r = reqRes.Item;
  if (!r) return 0;
  const request: RequestLite = { id: r.id, requestNo: r.requestNo, title: r.title, ownerId: r.ownerId };
  const planned = planNotifications(audit, request, members as unknown as MemberLite[]);
  if (!planned.length) return 0;

  // Profiles are only needed (and only read) when email is enabled.
  const profiles = deps.email.enabled && deps.sender ? await batchGet(planned.map((p) => userKey(p.recipientId))) : new Map<string, Item>();
  const now = deps.now ?? new Date();
  let written = 0;
  for (const p of planned) {
    const profile = profiles.get(`USER#${p.recipientId}|PROFILE`);
    const emailStatus = await deliverEmail(deps.email, deps.sender, profile, { title: p.title, body: p.body, requestId: p.linkToRequest ? request.id : null });
    const item = buildNotification({ planned: p, id, request, audit, now, emailStatus });
    try {
      await ddb.send(new PutCommand({ TableName: TABLE, Item: item, ConditionExpression: "attribute_not_exists(PK)" }));
      written++;
    } catch (e: any) {
      if (e?.name !== "ConditionalCheckFailedException") throw e; // already delivered by an earlier attempt
    }
  }
  return written;
};

const config = emailConfigFromEnv();
// The SES client exists only when email is enabled. With the default config it is never created.
const sender = config.enabled ? sesSender(config.from) : undefined;

export const handler = async (event: DynamoDBStreamEvent): Promise<DynamoDBBatchResponse> => {
  const batchItemFailures: { itemIdentifier: string }[] = [];
  for (const rec of event.Records ?? []) {
    if (rec.eventName !== "INSERT" || !rec.dynamodb?.NewImage) continue;
    try {
      const audit = unmarshall(rec.dynamodb.NewImage as Record<string, AttributeValue>);
      await processAudit(audit, { email: config, sender });
    } catch (e) {
      console.error(JSON.stringify({ level: "error", message: "notification processing failed", sequence: rec.dynamodb.SequenceNumber, error: String(e) }));
      // Report the failure so only this record (and later ones) are retried.
      if (rec.dynamodb.SequenceNumber) batchItemFailures.push({ itemIdentifier: rec.dynamodb.SequenceNumber });
      break;
    }
  }
  return { batchItemFailures };
};
