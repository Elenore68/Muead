import { BatchWriteCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, queryAll, TABLE, type Item } from "../lib/db";
import { initialsOf } from "../lib/auth";
import { badRequest } from "../lib/errors";
import { json, router, type Ctx } from "../lib/http";

const userKey = (id: string) => ({ PK: `USER#${id}`, SK: "PROFILE" });

const toProfile = (p: Item, roles: string[]) => ({
  id: p.userId,
  email: p.email,
  displayName: p.displayName,
  initials: p.initials,
  roles,
  teamSpecialties: p.teamSpecialties ?? [],
  notificationPrefs: p.notificationPrefs ?? { email: true },
  // Notifications are implemented in a later step.
  unreadNotifications: 0,
});

/**
 * GET /me
 * Just-in-time provisioning: the first call creates the profile from the verified token claims.
 * Cognito stays the source of truth for roles; they are mirrored here so other users can be searched by role.
 */
const getMe = async ({ caller }: Ctx) => {
  const now = new Date().toISOString();
  const existing = await queryAll({
    KeyConditionExpression: "PK = :pk",
    ExpressionAttributeValues: { ":pk": `USER#${caller.userId}` },
  });
  const profile = existing.find((i) => i.SK === "PROFILE");
  const storedRoles = existing.filter((i) => i.SK.startsWith("ROLE#")).map((i) => i.role as string);

  let saved: Item;
  if (!profile) {
    saved = {
      ...userKey(caller.userId),
      entityType: "USER",
      userId: caller.userId,
      email: caller.email,
      displayName: caller.displayName,
      initials: initialsOf(caller.displayName),
      status: "ACTIVE",
      notificationPrefs: { email: true },
      createdAt: now,
      lastLoginAt: now,
      GSI1PK: `EMAIL#${caller.email}`,
      GSI1SK: "USER",
    };
    await ddb.send(new PutCommand({ TableName: TABLE, Item: saved }));
  } else {
    const res = await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: userKey(caller.userId),
        UpdateExpression: "SET lastLoginAt = :now, email = :email, GSI1PK = :g1",
        ExpressionAttributeValues: { ":now": now, ":email": caller.email, ":g1": `EMAIL#${caller.email}` },
        ReturnValues: "ALL_NEW",
      }),
    );
    saved = res.Attributes as Item;
  }

  // Mirror the Cognito groups as one index item per role (a user may hold several roles).
  const toAdd = caller.roles.filter((r) => !storedRoles.includes(r));
  const toRemove = storedRoles.filter((r) => !(caller.roles as string[]).includes(r));
  const writes = [
    ...toAdd.map((role) => ({
      PutRequest: {
        Item: {
          PK: `USER#${caller.userId}`,
          SK: `ROLE#${role}`,
          entityType: "USER_ROLE",
          role,
          GSI2PK: `ROLE#${role}`,
          GSI2SK: `${saved.displayName}#${caller.userId}`,
        },
      },
    })),
    ...toRemove.map((role) => ({ DeleteRequest: { Key: { PK: `USER#${caller.userId}`, SK: `ROLE#${role}` } } })),
  ];
  if (writes.length) await ddb.send(new BatchWriteCommand({ RequestItems: { [TABLE]: writes } }));

  return json(200, toProfile(saved, caller.roles));
};

/** PATCH /me - own display name and notification preferences. */
const patchMe = async ({ caller, body }: Ctx) => {
  const sets: string[] = ["updatedAt = :now"];
  const values: Record<string, unknown> = { ":now": new Date().toISOString() };
  if (body.displayName !== undefined) {
    if (typeof body.displayName !== "string" || !body.displayName.trim() || body.displayName.trim().length > 80) {
      throw badRequest("displayName must be 1-80 characters", [{ field: "displayName", issue: "length" }]);
    }
    const name = body.displayName.trim();
    sets.push("displayName = :n", "initials = :i");
    values[":n"] = name;
    values[":i"] = initialsOf(name);
  }
  if (body.notificationPrefs !== undefined) {
    const p = body.notificationPrefs as Record<string, unknown> | null;
    if (!p || typeof p !== "object" || typeof p.email !== "boolean") {
      throw badRequest("notificationPrefs must be { email: boolean }", [{ field: "notificationPrefs", issue: "type" }]);
    }
    sets.push("notificationPrefs = :p");
    values[":p"] = { email: p.email };
  }
  if (sets.length === 1) throw badRequest("Nothing to update");
  const res = await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: userKey(caller.userId),
      UpdateExpression: `SET ${sets.join(", ")}`,
      // The profile is created by GET /me; require it so we never create a half-empty profile.
      ConditionExpression: "attribute_exists(PK)",
      ExpressionAttributeValues: values,
      ReturnValues: "ALL_NEW",
    }),
  ).catch((e) => {
    if (e?.name === "ConditionalCheckFailedException") throw badRequest("Call GET /me first to create your profile");
    throw e;
  });
  return json(200, toProfile(res.Attributes as Item, caller.roles));
};

export const handler = router({
  "GET /me": getMe,
  "PATCH /me": patchMe,
});
