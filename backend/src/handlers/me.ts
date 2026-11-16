import { PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { batchWriteAll, ddb, queryAll, TABLE, type Item } from "../lib/db";
import { initialsOf } from "../lib/auth";
import { badRequest } from "../lib/errors";
import { json, router, type Ctx } from "../lib/http";
import { directorySK, userKey } from "../lib/users";

const toProfile = (p: Item, roles: string[]) => ({
  id: p.userId,
  email: p.email,
  displayName: p.displayName,
  initials: p.initials,
  /** Organization-level groups only (PlatformAdmin, ApprovalEligible). Activity roles are per request. */
  roles,
  teamSpecialties: p.teamSpecialties ?? [],
  notificationPrefs: p.notificationPrefs ?? { email: true },
  // Notifications are implemented in a later step.
  unreadNotifications: 0,
});

/** Org-level group mirror item, searchable by group (GSI2) with a name snapshot for directory results. */
const roleItem = (p: Item, role: string): Item => ({
  PK: `USER#${p.userId}`,
  SK: `ROLE#${role}`,
  entityType: "USER_ROLE",
  role,
  userId: p.userId,
  displayName: p.displayName,
  initials: p.initials,
  email: p.email,
  GSI2PK: `ROLE#${role}`,
  GSI2SK: directorySK(p.displayName, p.userId),
});

/** Retries unprocessed writes and fails loudly instead of leaving the group mirror stale (finding I6). */
const batchWrite = batchWriteAll;

/**
 * GET /me
 * Just-in-time provisioning: the first call creates the profile (and directory entry) from the verified token.
 * Cognito stays the source of truth for org-level groups; they are mirrored here so users can be searched by group.
 * Mirror items for groups the token no longer has (including the retired activity-role groups) are deleted.
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
      GSI2PK: "DIRECTORY",
      GSI2SK: directorySK(caller.displayName, caller.userId),
    };
    await ddb.send(new PutCommand({ TableName: TABLE, Item: saved, ConditionExpression: "attribute_not_exists(PK)" })).catch(async (e) => {
      // Two first calls at once: the other one created it. Fall through to the update path.
      if (e?.name !== "ConditionalCheckFailedException") throw e;
    });
  }
  const res = await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: userKey(caller.userId),
      // Directory keys are (re)written so profiles created before the directory existed become searchable.
      UpdateExpression: "SET lastLoginAt = :now, email = :email, GSI1PK = :g1, GSI2PK = :dir, GSI2SK = :dsk",
      ExpressionAttributeValues: {
        ":now": now,
        ":email": caller.email,
        ":g1": `EMAIL#${caller.email}`,
        ":dir": "DIRECTORY",
        ":dsk": directorySK(profile?.displayName ?? caller.displayName, caller.userId),
      },
      ReturnValues: "ALL_NEW",
    }),
  );
  saved = res.Attributes as Item;

  // Sync org-level group mirror items (re-put existing ones too, so name snapshots stay current).
  const toRemove = storedRoles.filter((r) => !(caller.roles as string[]).includes(r));
  await batchWrite([
    ...caller.roles.map((role) => ({ PutRequest: { Item: roleItem(saved, role) } })),
    ...toRemove.map((role) => ({ DeleteRequest: { Key: { PK: `USER#${caller.userId}`, SK: `ROLE#${role}` } } })),
  ]);

  return json(200, toProfile(saved, caller.roles));
};

/** PATCH /me - own display name and notification preferences. */
const patchMe = async ({ caller, body }: Ctx) => {
  const sets: string[] = ["updatedAt = :now"];
  const values: Record<string, unknown> = { ":now": new Date().toISOString() };
  let newName: string | undefined;
  if (body.displayName !== undefined) {
    if (typeof body.displayName !== "string" || !body.displayName.trim() || body.displayName.trim().length > 80) {
      throw badRequest("displayName must be 1-80 characters", [{ field: "displayName", issue: "length" }]);
    }
    newName = body.displayName.trim();
    sets.push("displayName = :n", "initials = :i", "GSI2SK = :dsk");
    values[":n"] = newName;
    values[":i"] = initialsOf(newName);
    values[":dsk"] = directorySK(newName, caller.userId);
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
  const saved = res.Attributes as Item;
  // Keep the group mirror's name snapshot (used by directory search) in step with the profile.
  // Names already stored on members, approval records and audit entries stay as historical snapshots.
  if (newName) await batchWrite(caller.roles.map((role) => ({ PutRequest: { Item: roleItem(saved, role) } })));
  return json(200, toProfile(saved, caller.roles));
};

export const handler = router({
  "GET /me": getMe,
  "PATCH /me": patchMe,
});
