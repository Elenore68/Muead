import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, queryAll, queryCount, queryPage, TABLE, type Item } from "../lib/db";
import { badRequest, notFound } from "../lib/errors";
import { assertTokenPartition, decodeToken, encodeToken, json, parseLimit, router, type Ctx } from "../lib/http";
import { isNotificationId, notificationKey, toNotificationApi } from "../lib/notifications";

/*
 * Notifications API (api-specification.md 3.15, 13). Every endpoint works ONLY on the caller's own partition
 * (PK = USER#<caller>), so nobody can read or change another user's notifications.
 * Notifications are written by the notifier Lambda, never by clients.
 */
const MAX_READ_ALL = 500;

const list = async ({ caller, query }: Ctx) => {
  const limit = parseLimit(query.limit, 20, 50);
  if (query.unread !== undefined && !["true", "false"].includes(query.unread)) throw badRequest("unread must be true or false", [{ field: "unread", issue: "enum" }]);
  const unreadOnly = query.unread === "true";
  const pk = `USER#${caller.userId}`;
  const startKey = decodeToken(query.nextToken);
  assertTokenPartition(startKey, "PK", pk);
  if (startKey && !String(startKey.SK ?? "").startsWith("NOTIF#")) throw badRequest("Invalid nextToken");

  const page = await queryPage(
    {
      KeyConditionExpression: "PK = :p AND begins_with(SK, :n)",
      ExpressionAttributeValues: { ":p": pk, ":n": "NOTIF#" },
      ScanIndexForward: false, // newest first (ULID ids sort by time)
      ExclusiveStartKey: startKey,
    },
    limit,
    (n: Item) => !unreadOnly || !n.readAt,
  );
  return json(200, { items: page.items.map(toNotificationApi), nextToken: encodeToken(page.lastKey) });
};

const unreadCount = async ({ caller }: Ctx) => {
  const count = await queryCount({
    KeyConditionExpression: "PK = :p AND begins_with(SK, :n)",
    FilterExpression: "attribute_not_exists(readAt)",
    ExpressionAttributeValues: { ":p": `USER#${caller.userId}`, ":n": "NOTIF#" },
  });
  return json(200, { count });
};

const markRead = async ({ caller, path }: Ctx) => {
  const id = path.notificationId;
  if (!isNotificationId(id)) throw notFound("Notification not found");
  await ddb
    .send(
      new UpdateCommand({
        TableName: TABLE,
        Key: notificationKey(caller.userId, id),
        // Keeps the first read time; only the caller's own item can match this key.
        UpdateExpression: "SET #r = if_not_exists(#r, :now)",
        ConditionExpression: "attribute_exists(PK)",
        ExpressionAttributeNames: { "#r": "readAt" },
        ExpressionAttributeValues: { ":now": new Date().toISOString() },
      }),
    )
    .catch((e) => {
      if (e?.name === "ConditionalCheckFailedException") throw notFound("Notification not found");
      throw e;
    });
  return json(204);
};

const markAllRead = async ({ caller }: Ctx) => {
  const unread = await queryAll(
    {
      KeyConditionExpression: "PK = :p AND begins_with(SK, :n)",
      FilterExpression: "attribute_not_exists(readAt)",
      ExpressionAttributeValues: { ":p": `USER#${caller.userId}`, ":n": "NOTIF#" },
    },
    MAX_READ_ALL,
  );
  const now = new Date().toISOString();
  for (let i = 0; i < unread.length; i += 25) {
    await Promise.all(
      unread.slice(i, i + 25).map((n) =>
        ddb
          .send(
            new UpdateCommand({
              TableName: TABLE,
              Key: { PK: n.PK, SK: n.SK },
              UpdateExpression: "SET #r = if_not_exists(#r, :now)",
              ConditionExpression: "attribute_exists(PK)",
              ExpressionAttributeNames: { "#r": "readAt" },
              ExpressionAttributeValues: { ":now": now },
            }),
          )
          .catch((e) => {
            if (e?.name !== "ConditionalCheckFailedException") throw e; // expired by TTL meanwhile
          }),
      ),
    );
  }
  return json(204);
};

export const handler = router({
  "GET /notifications": list,
  "GET /notifications/unread-count": unreadCount,
  "POST /notifications/{notificationId}/read": markRead,
  "POST /notifications/read-all": markAllRead,
});
