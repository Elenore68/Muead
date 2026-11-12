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
