import type { ApprovalHistory } from "../api/approvals";
import type { Member } from "../api/members";
import type { ApiStatus, RequestDetail } from "../api/requests";

/*
 * UI-side permission hints. They decide which controls are SHOWN; the backend enforces every rule again
 * (api-specification.md 12.1-12.3). Roles are per request: everything here is computed from THIS request's
 * `viewer` block and members, never from a global role. PlatformAdmin gets no approval shortcut.
 */
export type Viewer = NonNullable<RequestDetail["viewer"]>;

const APPROVER_EDITABLE: ApiStatus[] = ["DRAFT", "REJECTED"];
const MEMBERSHIP_FROZEN: ApiStatus[] = ["PENDING_APPROVAL", "COMPLETED", "CANCELLED"];

/** Owner or platform admin, and approvers may change only in DRAFT / REJECTED. */
export const canChangeApprovers = (viewer: Viewer | undefined, status: ApiStatus): boolean =>
  !!viewer?.canManageMembers && APPROVER_EDITABLE.includes(status);

/** Owner or platform admin; participants may change in every state except pending / finished. */
export const canChangeParticipants = (viewer: Viewer | undefined, status: ApiStatus): boolean =>
  !!viewer?.canManageMembers && !MEMBERSHIP_FROZEN.includes(status);

export const canChangePolicy = (viewer: Viewer | undefined, status: ApiStatus): boolean =>
  !!viewer?.canEdit && APPROVER_EDITABLE.includes(status);

export const activeApprovers = (members: Member[]): Member[] =>
  members.filter((m) => m.status === "ACTIVE" && m.activityRole === "APPROVER");

export const canSubmit = (viewer: Viewer | undefined, status: ApiStatus, members: Member[]): boolean =>
  !!viewer?.canEdit && APPROVER_EDITABLE.includes(status) && activeApprovers(members).length > 0;

export const canWithdraw = (viewer: Viewer | undefined, status: ApiStatus): boolean => !!viewer?.canEdit && status === "PENDING_APPROVAL";

/** The caller's own decision record in the current round, if they are assigned to it. */
export const myCurrentRecord = (history: ApprovalHistory | null, userId: string | undefined) => {
  if (!history || !userId || !history.currentRound) return undefined;
  const round = history.rounds.find((r) => r.round === history.currentRound);
  return round?.approvers.find((a) => a.userId === userId);
};

/**
 * Decision controls are shown only when ALL of these hold (mirrors backend authorizeDecision):
 * request is pending; caller is an APPROVER member of THIS request; caller has a PENDING record in the
 * current round; caller's token is in ApprovalEligible. Owners, participants and unassigned admins never see them.
 */
export const canDecide = (p: {
  status: ApiStatus;
  viewer: Viewer | undefined;
  history: ApprovalHistory | null;
  userId: string | undefined;
  orgRoles: string[] | undefined;
}): boolean =>
  p.status === "PENDING_APPROVAL" &&
  p.viewer?.activityRole === "APPROVER" &&
  myCurrentRecord(p.history, p.userId)?.decision === "PENDING" &&
  !!p.orgRoles?.includes("ApprovalEligible");

/**
 * Directory results that may be offered for assignment: never someone who is already an ACTIVE member
 * (one role per person per request), and never the caller as approver (self-assignment is forbidden).
 */
export const assignableUsers = <U extends { id: string }>(users: U[], members: Member[], role: "PARTICIPANT" | "APPROVER", callerId: string | undefined): U[] => {
  const taken = new Set(members.filter((m) => m.status === "ACTIVE").map((m) => m.userId));
  return users.filter((u) => !taken.has(u.id) && !(role === "APPROVER" && u.id === callerId));
};

/** TASK 06: the owner (or an admin) may edit the plan only while it is a draft or was rejected. */
export const canEditRequest = (viewer: Viewer | undefined, status: ApiStatus): boolean => !!viewer?.canEdit && APPROVER_EDITABLE.includes(status);

/** TASK 06: lifecycle buttons come from the backend's `viewer.lifecycle`; nothing is guessed from roles. */
export const lifecycleActions = (viewer: Viewer | undefined): { next: ApiStatus | null; canCancel: boolean } =>
  viewer?.lifecycle ?? { next: null, canCancel: false };

/* ---------- TASK 07 ---------- */
const TASKS_FROZEN: ApiStatus[] = ["COMPLETED", "CANCELLED"];

/** Owner or admin: create, edit, reassign, delete tasks (not on finished requests). */
export const canManageTasks = (viewer: Viewer | undefined, status: ApiStatus): boolean => !!viewer?.canEdit && !TASKS_FROZEN.includes(status);

/** The assignee may change only the status of their own task. */
export const canChangeTaskStatus = (viewer: Viewer | undefined, status: ApiStatus, assigneeId: string, userId: string | undefined): boolean =>
  !TASKS_FROZEN.includes(status) && (!!viewer?.canEdit || (!!userId && assigneeId === userId && viewer?.activityRole != null));

/** People who can be given a task: the owner and participants who have not declined. */
export const assignableToTasks = (members: Member[]): Member[] =>
  members.filter((m) => m.status === "ACTIVE" && (m.activityRole === "OWNER" || (m.activityRole === "PARTICIPANT" && m.participation !== "DECLINED")));

/** The signed-in person may answer only for themselves, as a participant, on an unfinished request. */
export const canRespondToParticipation = (member: Member | undefined, userId: string | undefined, status: ApiStatus): boolean =>
  !!member && !!userId && member.userId === userId && member.status === "ACTIVE" && member.activityRole === "PARTICIPANT" && !TASKS_FROZEN.includes(status);

/** Owner or admin may edit a member's details (not the owner row), not on finished requests. */
export const canEditMemberDetails = (viewer: Viewer | undefined, status: ApiStatus, member: Member): boolean =>
  !!viewer?.canManageMembers && member.activityRole !== "OWNER" && member.status === "ACTIVE" && !TASKS_FROZEN.includes(status);
