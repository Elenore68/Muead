import { describe, expect, test } from "vitest";
import type { ApprovalHistory } from "../api/approvals";
import type { Member } from "../api/members";
import {
  assignableUsers,
  canChangeApprovers,
  canChangeParticipants,
  canChangePolicy,
  canDecide,
  canSubmit,
  canWithdraw,
  myCurrentRecord,
  type Viewer,
} from "../data/permissions";

const OWNER = "u-owner", SARA = "u-sara", PART = "u-part", ADMIN = "u-admin";
const member = (userId: string, activityRole: Member["activityRole"], status: Member["status"] = "ACTIVE"): Member => ({
  userId, displayName: userId, initials: "XX", activityRole, status, specialty: null, responsibilities: null,
  assignedBy: { id: OWNER, displayName: "Owner", activityRole: "OWNER" }, assignedAt: "2026-11-12T00:00:00Z", removedBy: null, removedAt: null,
});
const owner: Viewer = { activityRole: "OWNER", canEdit: true, canManageMembers: true };
const approver: Viewer = { activityRole: "APPROVER", canEdit: false, canManageMembers: false };
const participant: Viewer = { activityRole: "PARTICIPANT", canEdit: false, canManageMembers: false };
const adminNonMember: Viewer = { activityRole: null, canEdit: true, canManageMembers: true };

const history = (decision: string, userId = SARA, currentRound = 1): ApprovalHistory => ({
  approvalState: "PENDING", approvalPolicy: "ANY_ONE", currentRound,
  rounds: [{
    round: 1, policy: "ANY_ONE", status: "OPEN", submittedAt: "2026-11-12T00:00:00Z", submittedBy: { id: OWNER, displayName: "Owner", activityRole: "OWNER" }, decidedAt: null,
    approvers: [{ userId, displayName: userId, initials: "XX", activityRole: "APPROVER", decision: decision as never, comment: null, decidedAt: null }],
  }],
});

describe("membership controls", () => {
  test("approvers change only in DRAFT/REJECTED, by owner or admin", () => {
    expect(canChangeApprovers(owner, "DRAFT")).toBe(true);
    expect(canChangeApprovers(owner, "REJECTED")).toBe(true);
    expect(canChangeApprovers(owner, "PENDING_APPROVAL")).toBe(false);
    expect(canChangeApprovers(owner, "APPROVED")).toBe(false);
    expect(canChangeApprovers(adminNonMember, "DRAFT")).toBe(true);
    expect(canChangeApprovers(approver, "DRAFT")).toBe(false);
    expect(canChangeApprovers(participant, "DRAFT")).toBe(false);
    expect(canChangeApprovers(undefined, "DRAFT")).toBe(false);
  });

  test("participants are locked while pending and when finished", () => {
    expect(canChangeParticipants(owner, "IN_PROGRESS")).toBe(true);
    expect(canChangeParticipants(owner, "PENDING_APPROVAL")).toBe(false);
    expect(canChangeParticipants(owner, "COMPLETED")).toBe(false);
    expect(canChangeParticipants(approver, "DRAFT")).toBe(false);
  });

  test("policy, submit and withdraw follow canEdit and status", () => {
    expect(canChangePolicy(owner, "DRAFT")).toBe(true);
    expect(canChangePolicy(approver, "DRAFT")).toBe(false);
    expect(canSubmit(owner, "DRAFT", [member(OWNER, "OWNER")])).toBe(false);
    expect(canSubmit(owner, "DRAFT", [member(OWNER, "OWNER"), member(SARA, "APPROVER")])).toBe(true);
    expect(canSubmit(owner, "DRAFT", [member(SARA, "APPROVER", "REMOVED")])).toBe(false);
    expect(canSubmit(owner, "PENDING_APPROVAL", [member(SARA, "APPROVER")])).toBe(false);
    expect(canSubmit(approver, "DRAFT", [member(SARA, "APPROVER")])).toBe(false);
    expect(canWithdraw(owner, "PENDING_APPROVAL")).toBe(true);
    expect(canWithdraw(owner, "DRAFT")).toBe(false);
    expect(canWithdraw(approver, "PENDING_APPROVAL")).toBe(false);
  });

  test("directory results: hide active members and the caller as approver", () => {
    const users = [{ id: OWNER }, { id: SARA }, { id: PART }, { id: ADMIN }, { id: "u-new" }];
    const members = [member(OWNER, "OWNER"), member(PART, "PARTICIPANT"), member(SARA, "APPROVER", "REMOVED")];
    expect(assignableUsers(users, members, "APPROVER", ADMIN).map((u) => u.id)).toEqual([SARA, "u-new"]);
    expect(assignableUsers(users, members, "PARTICIPANT", ADMIN).map((u) => u.id)).toEqual([SARA, ADMIN, "u-new"]);
  });
});

describe("decision controls (activity-scoped, no admin shortcut)", () => {
  const base = { status: "PENDING_APPROVAL" as const, viewer: approver, history: history("PENDING"), userId: SARA, orgRoles: ["ApprovalEligible"] };
  test("assigned, eligible approver with a pending record", () => expect(canDecide(base)).toBe(true));
  test("owner / participant never", () => {
    expect(canDecide({ ...base, viewer: owner, userId: OWNER })).toBe(false);
    expect(canDecide({ ...base, viewer: participant, userId: PART })).toBe(false);
  });
  test("platform admin who is not an assigned approver never", () => {
    expect(canDecide({ ...base, viewer: adminNonMember, userId: ADMIN, orgRoles: ["PlatformAdmin", "ApprovalEligible"] })).toBe(false);
  });
  test("eligibility revoked, already decided, not pending", () => {
    expect(canDecide({ ...base, orgRoles: [] })).toBe(false);
    expect(canDecide({ ...base, history: history("REJECTED") })).toBe(false);
    expect(canDecide({ ...base, status: "APPROVED" })).toBe(false);
  });
  test("record must be in the current round", () => {
    expect(canDecide({ ...base, history: history("PENDING", SARA, 2) })).toBe(false);
    expect(myCurrentRecord(history("APPROVED"), SARA)?.decision).toBe("APPROVED");
    expect(myCurrentRecord(null, SARA)).toBeUndefined();
  });
});
