import { GetCommand } from "@aws-sdk/lib-dynamodb";
import type { Caller } from "./auth";
import { batchGet, ddb, queryAll, TABLE, type Item } from "./db";
import { ApiError, forbidden, notFound } from "./errors";
import { reqKey, type Status } from "./requests";

/**
 * Activity-scoped membership (database-design.md 3.4).
 * One item per person per request:  PK=REQ#<requestId>  SK=MEMBER#<userId>
 * Because the key is (request, user), a person can hold only ONE activity role in a request, so
 * "approver AND owner/participant of the same request" is impossible by construction.
 * The same person can hold different roles in different requests (different partitions).
 */
export type ActivityRole = "OWNER" | "PARTICIPANT" | "APPROVER";
export const ASSIGNABLE_ROLES = ["PARTICIPANT", "APPROVER"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/** Caps keep every approval transaction far below DynamoDB's 100-item limit (see lib/approvals.ts). */
export const MAX_APPROVERS = 20;
export const MAX_MEMBERS = 50;

export const TEAMS = ["Cloud", "Database", "Application", "OS", "SecurityNetwork"] as const;

/** Statuses in which approvers may be added/removed (decision 6). */
export const APPROVER_EDITABLE: Status[] = ["DRAFT", "REJECTED"];
/** No membership change at all: locked during approval, frozen when finished. */
export const MEMBERSHIP_LOCKED: Status[] = ["PENDING_APPROVAL"];
export const MEMBERSHIP_FROZEN: Status[] = ["COMPLETED", "CANCELLED"];

export const memberKey = (requestId: string, userId: string) => ({ PK: `REQ#${requestId}`, SK: `MEMBER#${userId}` });

export interface Snapshot {
  userId: string;
  displayName: string;
  initials: string;
}

/** Builds an ACTIVE member item. GSI1 = "my activities", newest request first. */
export const buildMember = (p: {
  request: Item;
  user: Snapshot;
  role: ActivityRole;
  assignedBy: Snapshot;
  assignedByRole: string;
  specialty?: string;
  responsibilities?: string;
  now: string;
}): Item => ({
  ...memberKey(p.request.id, p.user.userId),
  entityType: "MEMBER",
  requestId: p.request.id,
  userId: p.user.userId,
  displayName: p.user.displayName,
  initials: p.user.initials,
  activityRole: p.role,
  status: "ACTIVE",
  specialty: p.specialty,
  responsibilities: p.responsibilities,
  assignedBy: p.assignedBy.userId,
  assignedByName: p.assignedBy.displayName,
  assignedByRole: p.assignedByRole,
  assignedAt: p.now,
  GSI1PK: `MEMBER#${p.user.userId}`,
  GSI1SK: `${p.request.createdAt}#${p.request.id}`,
});

export const toMemberApi = (m: Item) => ({
  userId: m.userId,
  displayName: m.displayName,
  initials: m.initials,
  activityRole: m.activityRole,
  status: m.status,
  specialty: m.specialty ?? null,
  responsibilities: m.responsibilities ?? null,
  assignedBy: { id: m.assignedBy, displayName: m.assignedByName, activityRole: m.assignedByRole },
  assignedAt: m.assignedAt,
  removedBy: m.removedBy ? { id: m.removedBy, displayName: m.removedByName, activityRole: m.removedByRole } : null,
  removedAt: m.removedAt ?? null,
});

/** `consistent: true` for reads that feed approval transitions (submit, decide, withdraw). */
export const getMember = async (requestId: string, userId: string, opts: { consistent?: boolean } = {}): Promise<Item | undefined> =>
  (await ddb.send(new GetCommand({ TableName: TABLE, Key: memberKey(requestId, userId), ConsistentRead: opts.consistent === true }))).Item;

export const listMembers = (requestId: string, opts: { consistent?: boolean } = {}): Promise<Item[]> =>
  queryAll({
    KeyConditionExpression: "PK = :p AND begins_with(SK, :m)",
    ExpressionAttributeValues: { ":p": `REQ#${requestId}`, ":m": "MEMBER#" },
    ConsistentRead: opts.consistent === true,
  });

export const isActive = (m: Item | undefined): m is Item => m?.status === "ACTIVE";

/* ------------------------------------------------------------------ access (pure + loader) */
export interface Access {
  /** Caller's ACTIVE activity role in this request, if any. */
  role?: ActivityRole;
  canView: boolean;
  /** Edit request content (fields, attachments, submit). */
  canEdit: boolean;
  /** Add / remove members and approvers (decision 5: admins may manage others' requests). */
  canManageMembers: boolean;
  /** Role label written to the audit log for actions taken by this caller. */
  auditRole: string;
}

export const resolveAccess = (caller: Caller, member: Item | undefined): Access => {
  const role = isActive(member) ? (member.activityRole as ActivityRole) : undefined;
  const isOwner = role === "OWNER";
  return {
    role,
    canView: caller.isAdmin || role !== undefined,
    canEdit: isOwner || caller.isAdmin,
    canManageMembers: isOwner || caller.isAdmin,
    auditRole: role ?? (caller.isAdmin ? "PLATFORM_ADMIN" : "NONE"),
  };
};

export const loadAccess = async (requestId: string, caller: Caller, opts: { consistent?: boolean } = {}): Promise<Access> =>
  resolveAccess(caller, await getMember(requestId, caller.userId, opts));

/**
 * 404 (not 403) so the existence of requests the caller may not see is not revealed.
 * Approval transitions pass `{ consistent: true }` so every read on those paths is strongly consistent.
 */
export const assertView = async (r: Item, caller: Caller, opts: { consistent?: boolean } = {}): Promise<Access> => {
  const a = await loadAccess(r.id, caller, opts);
  if (!a.canView) throw notFound("Request not found");
  return a;
};

export const assertEdit = async (r: Item, caller: Caller): Promise<Access> => {
  const a = await assertView(r, caller);
  if (!a.canEdit) throw forbidden("Only the owner of this request can change it");
  return a;
};

/* ------------------------------------------------------------------ assignment rules (pure) */
export interface AssignmentInput {
  caller: Caller;
  access: Access;
  requestStatus: Status;
  ownerId: string;
  targetUserId: string;
  /** Profile exists (user signed in at least once). */
  targetExists: boolean;
  targetActive: boolean;
  /** Mirror of the ApprovalEligible Cognito group (refreshed on the user's sign-in). */
  targetEligible: boolean;
  /** Existing member item for (request, target) in any status. */
  existing?: Item;
  role: AssignableRole;
  activeApprovers: number;
  activeMembers: number;
}

const lockChecks = (status: Status, role: string) => {
  if (MEMBERSHIP_FROZEN.includes(status)) throw new ApiError(409, "INVALID_STATE", `Members cannot change when the request is ${status}`);
  if (MEMBERSHIP_LOCKED.includes(status)) {
    throw new ApiError(409, "LOCKED_WHILE_PENDING", "Assignments are locked while the request is waiting for approval");
  }
  if (role === "APPROVER" && !APPROVER_EDITABLE.includes(status)) {
    throw new ApiError(409, "APPROVERS_LOCKED", "Approvers can only change while the request is Draft or Rejected");
  }
};

/** Throws the first rule violation. Order matters: permission, state, target, conflicts, caps. */
export const validateAssignment = (i: AssignmentInput): void => {
  if (!i.access.canManageMembers) throw forbidden("Only the owner of this request or a platform admin can assign members");
  lockChecks(i.requestStatus, i.role);
  if (!i.targetExists) throw new ApiError(404, "USER_NOT_FOUND", "User not found. People appear in the directory after their first sign-in.");
  if (!i.targetActive) throw new ApiError(409, "USER_INACTIVE", "This user is not active");
  if (isActive(i.existing)) {
    if (i.existing.activityRole === i.role) throw new ApiError(409, "ALREADY_ASSIGNED", `This person is already a ${i.role.toLowerCase()} of this request`);
    throw new ApiError(
      409,
      "ROLE_CONFLICT",
      `This person is already the ${String(i.existing.activityRole).toLowerCase()} of this request. A person can hold only one role per request, so owners and participants cannot approve it.`,
    );
  }
  if (i.role === "APPROVER") {
    if (i.targetUserId === i.ownerId) throw new ApiError(409, "ROLE_CONFLICT", "The owner cannot approve their own request");
    // Decision 5: nobody (platform admins included) can make themselves an approver.
    if (i.targetUserId === i.caller.userId) throw new ApiError(403, "SELF_ASSIGNMENT_FORBIDDEN", "You cannot assign yourself as an approver");
    if (!i.targetEligible) throw new ApiError(409, "NOT_ELIGIBLE", "This person is not in the ApprovalEligible group");
    if (i.activeApprovers >= MAX_APPROVERS) throw new ApiError(409, "APPROVER_LIMIT", `A request can have at most ${MAX_APPROVERS} approvers`);
  }
  if (i.activeMembers >= MAX_MEMBERS) throw new ApiError(409, "MEMBER_LIMIT", `A request can have at most ${MAX_MEMBERS} members`);
};

export interface RemovalInput {
  access: Access;
  requestStatus: Status;
  member?: Item;
}

export const validateRemoval = (i: RemovalInput): void => {
  if (!i.access.canManageMembers) throw forbidden("Only the owner of this request or a platform admin can remove members");
  if (!isActive(i.member)) throw notFound("Member not found");
  if (i.member.activityRole === "OWNER") throw new ApiError(400, "CANNOT_REMOVE_OWNER", "The owner cannot be removed from the request");
  lockChecks(i.requestStatus, i.member.activityRole);
};

/* ------------------------------------------------------------------ "my requests" through membership */
/** Request items for every ACTIVE membership of a user (all roles unless `role` is given). Capped. */
export const memberRequests = async (userId: string, role?: ActivityRole, max = 2000): Promise<Item[]> => {
  const members = await queryAll(
    {
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :p",
      FilterExpression: role ? "#st = :a AND activityRole = :r" : "#st = :a",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: { ":p": `MEMBER#${userId}`, ":a": "ACTIVE", ...(role ? { ":r": role } : {}) },
      ScanIndexForward: false,
    },
    max,
  );
  const reqs = await batchGet(members.map((m) => reqKey(m.requestId)));
  return members.map((m) => reqs.get(`REQ#${m.requestId}|META`)).filter((r): r is Item => !!r && !r.archived);
};
