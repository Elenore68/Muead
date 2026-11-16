import { auditItem } from "../lib/audit";
import { TABLE, transact, txConditionFailed, type TransactItem } from "../lib/db";
import { ApiError, badRequest, conflict } from "../lib/errors";
import { json, router, type Ctx } from "../lib/http";
import {
  APPROVER_EDITABLE,
  ASSIGNABLE_ROLES,
  assertView,
  buildMember,
  getMember,
  isActive,
  listMembers,
  MAX_APPROVERS,
  MAX_MEMBERS,
  MEMBERSHIP_FROZEN,
  MEMBERSHIP_LOCKED,
  memberKey,
  TEAMS,
  toMemberApi,
  validateAssignment,
  validateRemoval,
  type AssignableRole,
} from "../lib/members";
import { loadRequest, reqKey, STATUSES, type Status } from "../lib/requests";
import { loadUserFacts } from "../lib/users";
import { initialsOf } from "../lib/auth";

const COGNITO_SUB = /^[0-9a-f-]{36}$/i;

/**
 * Bumps the request's membership revision under the same lock rules that validateAssignment applied,
 * so a concurrent submit (which checks membersRev) or status change cannot interleave with this write.
 */
const requestGuard = (requestId: string, role: string): TransactItem => {
  const allowed = role === "APPROVER" ? APPROVER_EDITABLE : STATUSES.filter((s) => !MEMBERSHIP_LOCKED.includes(s) && !MEMBERSHIP_FROZEN.includes(s));
  const names: Record<string, string> = { "#s": "status" };
  const values: Record<string, unknown> = { ":one": 1, ":zero": 0 };
  allowed.forEach((s, i) => (values[`:s${i}`] = s));
  return {
    Update: {
      TableName: TABLE,
      Key: reqKey(requestId),
      UpdateExpression: "SET membersRev = if_not_exists(membersRev, :zero) + :one",
      ConditionExpression: `attribute_exists(PK) AND #s IN (${allowed.map((_, i) => `:s${i}`).join(", ")})`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    },
  };
};

const CHANGED = "The request or its members were changed at the same time. Reload and try again.";

/* ------------------------------------------------------------------ GET /requests/{id}/members */
const list = async ({ caller, path, query }: Ctx) => {
  const r = await loadRequest(path.requestId);
  await assertView(r, caller);
  const includeRemoved = query.includeRemoved === "true";
  const members = (await listMembers(r.id)).filter((m) => includeRemoved || isActive(m));
  const order = { OWNER: 0, APPROVER: 1, PARTICIPANT: 2 } as Record<string, number>;
  members.sort((a, b) => (order[a.activityRole] ?? 9) - (order[b.activityRole] ?? 9) || String(a.assignedAt).localeCompare(String(b.assignedAt)));
  return json(200, {
    items: members.map(toMemberApi),
    limits: { maxApprovers: MAX_APPROVERS, maxMembers: MAX_MEMBERS },
  });
};

/* ------------------------------------------------------------------ POST /requests/{id}/members */
const add = async ({ caller, path, body }: Ctx) => {
  const role = body.activityRole;
  if (typeof role !== "string" || !(ASSIGNABLE_ROLES as readonly string[]).includes(role)) {
    throw badRequest("activityRole must be PARTICIPANT or APPROVER", [{ field: "activityRole", issue: "enum" }]);
  }
  const userId = body.userId;
  if (typeof userId !== "string" || !COGNITO_SUB.test(userId)) throw badRequest("userId is required", [{ field: "userId", issue: "format" }]);
  let specialty: string | undefined;
  if (body.specialty !== undefined && body.specialty !== null) {
    if (typeof body.specialty !== "string" || !(TEAMS as readonly string[]).includes(body.specialty)) {
      throw badRequest(`specialty must be one of ${TEAMS.join(", ")}`, [{ field: "specialty", issue: "enum" }]);
    }
    specialty = body.specialty;
  }
  let responsibilities: string | undefined;
  if (body.responsibilities !== undefined && body.responsibilities !== null) {
    if (typeof body.responsibilities !== "string" || body.responsibilities.trim().length > 1000) {
      throw badRequest("responsibilities must be text of at most 1000 characters", [{ field: "responsibilities", issue: "length" }]);
    }
    responsibilities = body.responsibilities.trim() || undefined;
  }

  const r = await loadRequest(path.requestId);
  const access = await assertView(r, caller);
  // Consistent read so role conflicts and caps are checked against the latest members.
  const [members, facts] = await Promise.all([listMembers(r.id, { consistent: true }), loadUserFacts([userId])]);
  const target = facts.get(userId)!;
  const existing = members.find((m) => m.userId === userId);
  const active = members.filter(isActive);

  validateAssignment({
    caller,
    access,
    requestStatus: r.status as Status,
    ownerId: r.ownerId,
    targetUserId: userId,
    targetExists: target.exists,
    targetActive: target.active,
    targetEligible: target.eligible,
    existing,
    role: role as AssignableRole,
    activeApprovers: active.filter((m) => m.activityRole === "APPROVER").length,
    activeMembers: active.length,
  });

  const now = new Date().toISOString();
  const actor = { userId: caller.userId, displayName: caller.displayName, initials: initialsOf(caller.displayName) };
  const p = target.profile!;
  const member = buildMember({
    request: r,
    user: { userId, displayName: p.displayName, initials: p.initials },
    role: role as AssignableRole,
    assignedBy: actor,
    assignedByRole: access.auditRole,
    specialty,
    responsibilities,
    now,
  });

  try {
    await transact([
      {
        // New member, or re-activating someone removed earlier (their removal stays in the audit log).
        Put: {
          TableName: TABLE,
          Item: member,
          ConditionExpression: "attribute_not_exists(PK) OR #st = :removed",
          ExpressionAttributeNames: { "#st": "status" },
          ExpressionAttributeValues: { ":removed": "REMOVED" },
        },
      },
      requestGuard(r.id, role),
      {
        Put: {
          TableName: TABLE,
          Item: auditItem(r.id, { ...actor, activityRole: access.auditRole }, role === "APPROVER" ? "APPROVER_ASSIGNED" : "MEMBER_ADDED", {
            targetUserId: userId,
            targetName: p.displayName,
            targetActivityRole: role,
            targetApprovalEligible: target.eligible,
            specialty,
          }),
        },
      },
    ]);
  } catch (e) {
    if (txConditionFailed(e)) throw conflict("CONCURRENT_UPDATE", CHANGED);
    throw e;
  }
  return json(201, toMemberApi(member));
};

/* ------------------------------------------------------------------ DELETE /requests/{id}/members/{userId} */
const remove = async ({ caller, path }: Ctx) => {
  const r = await loadRequest(path.requestId);
  const access = await assertView(r, caller);
  const userId = path.userId;
  if (!COGNITO_SUB.test(userId)) throw new ApiError(404, "NOT_FOUND", "Member not found");
  const member = await getMember(r.id, userId, { consistent: true });
  validateRemoval({ access, requestStatus: r.status as Status, member });

  const now = new Date().toISOString();
  const actor = { userId: caller.userId, displayName: caller.displayName, activityRole: access.auditRole };
  try {
    await transact([
      {
        // Soft remove: the record stays for history; dropping GSI1 keys removes it from "my activities".
        Update: {
          TableName: TABLE,
          Key: memberKey(r.id, userId),
          UpdateExpression: "SET #st = :removed, removedAt = :now, removedBy = :by, removedByName = :byName, removedByRole = :byRole REMOVE GSI1PK, GSI1SK",
          ConditionExpression: "#st = :active",
          ExpressionAttributeNames: { "#st": "status" },
          ExpressionAttributeValues: {
            ":removed": "REMOVED",
            ":active": "ACTIVE",
            ":now": now,
            ":by": caller.userId,
            ":byName": caller.displayName,
            ":byRole": access.auditRole,
          },
        },
      },
      requestGuard(r.id, member!.activityRole),
      {
        Put: {
          TableName: TABLE,
          Item: auditItem(r.id, actor, member!.activityRole === "APPROVER" ? "APPROVER_REMOVED" : "MEMBER_REMOVED", {
            targetUserId: userId,
            targetName: member!.displayName,
            targetActivityRole: member!.activityRole,
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
  "GET /requests/{requestId}/members": list,
  "POST /requests/{requestId}/members": add,
  "DELETE /requests/{requestId}/members/{userId}": remove,
});

