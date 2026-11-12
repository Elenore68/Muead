import "./helpers/env";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authorizeDecision,
  computeOutcome,
  decisionRecordUpdate,
  parseDecisionBody,
  parseWithdrawBody,
  validateSubmit,
  validateWithdraw,
} from "../src/lib/approvals";
import type { Caller } from "../src/lib/auth";
import { MAX_TRANSACTION_ITEMS, transact } from "../src/lib/db";
import { MAX_APPROVERS, resolveAccess, validateAssignment, validateRemoval, type AssignmentInput } from "../src/lib/members";
import { reservedWordsIn } from "./helpers/fakeDb";

const code = (fn: () => unknown): string => {
  try {
    fn();
    return "OK";
  } catch (e: any) {
    return e.code ?? String(e);
  }
};
const U = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const user = (id: string, o: Partial<Caller> = {}): Caller => ({ userId: id, email: "", displayName: id, roles: [], isAdmin: false, approvalEligible: false, ...o });
const OWNER = U(1), SARA = U(2), PART = U(3), ADMIN = U(9);
const m = (userId: string, activityRole: string, status = "ACTIVE") => ({ userId, activityRole, status });
const admin = user(ADMIN, { isAdmin: true, approvalEligible: true, roles: ["PlatformAdmin", "ApprovalEligible"] });
const sara = user(SARA, { approvalEligible: true });

test("access is activity-scoped", () => {
  assert.deepEqual(resolveAccess(user(OWNER), m(OWNER, "OWNER")), { role: "OWNER", canView: true, canEdit: true, canManageMembers: true, auditRole: "OWNER" });
  const ap = resolveAccess(user(SARA), m(SARA, "APPROVER"));
  assert.ok(ap.canView && !ap.canEdit && !ap.canManageMembers);
  assert.equal(resolveAccess(user(SARA), m(SARA, "APPROVER", "REMOVED")).canView, false);
  assert.equal(resolveAccess(user(SARA), undefined).canView, false);
  const ad = resolveAccess(admin, undefined);
  assert.ok(ad.canView && ad.canManageMembers && ad.auditRole === "PLATFORM_ADMIN" && ad.role === undefined);
});

test("assignment rules", () => {
  const base = (o: Partial<AssignmentInput> = {}): AssignmentInput => ({
    caller: user(OWNER), access: resolveAccess(user(OWNER), m(OWNER, "OWNER")), requestStatus: "DRAFT", ownerId: OWNER,
    targetUserId: SARA, targetExists: true, targetActive: true, targetEligible: true, existing: undefined, role: "APPROVER",
    activeApprovers: 0, activeMembers: 1, ...o,
  });
  const cases: [string, Partial<AssignmentInput>, string][] = [
    ["owner assigns eligible approver", {}, "OK"],
    ["non-manager", { caller: user(SARA), access: resolveAccess(user(SARA), m(SARA, "APPROVER")) }, "FORBIDDEN"],
    ["locked while pending", { requestStatus: "PENDING_APPROVAL" }, "LOCKED_WHILE_PENDING"],
    ["participant locked while pending", { requestStatus: "PENDING_APPROVAL", role: "PARTICIPANT" }, "LOCKED_WHILE_PENDING"],
    ["approvers locked after approval", { requestStatus: "APPROVED" }, "APPROVERS_LOCKED"],
    ["participant added after approval", { requestStatus: "IN_PROGRESS", role: "PARTICIPANT" }, "OK"],
    ["frozen when completed", { requestStatus: "COMPLETED", role: "PARTICIPANT" }, "INVALID_STATE"],
    ["unknown user", { targetExists: false }, "USER_NOT_FOUND"],
    ["participant -> approver", { existing: m(SARA, "PARTICIPANT") }, "ROLE_CONFLICT"],
    ["owner -> approver", { targetUserId: OWNER, existing: m(OWNER, "OWNER") }, "ROLE_CONFLICT"],
    ["approver -> participant", { role: "PARTICIPANT", existing: m(SARA, "APPROVER") }, "ROLE_CONFLICT"],
    ["already assigned", { existing: m(SARA, "APPROVER") }, "ALREADY_ASSIGNED"],
    ["removed can be re-assigned", { existing: m(SARA, "PARTICIPANT", "REMOVED") }, "OK"],
    ["not eligible", { targetEligible: false }, "NOT_ELIGIBLE"],
    ["participant needs no eligibility", { role: "PARTICIPANT", targetEligible: false }, "OK"],
    ["approver cap", { activeApprovers: MAX_APPROVERS }, "APPROVER_LIMIT"],
    ["member cap", { role: "PARTICIPANT", activeMembers: 50 }, "MEMBER_LIMIT"],
    ["admin manages others' request", { caller: admin, access: resolveAccess(admin, undefined) }, "OK"],
    ["admin cannot self-assign", { caller: admin, access: resolveAccess(admin, undefined), targetUserId: ADMIN }, "SELF_ASSIGNMENT_FORBIDDEN"],
    ["admin assigned by owner", { targetUserId: ADMIN }, "OK"],
  ];
  for (const [name, o, expected] of cases) assert.equal(code(() => validateAssignment(base(o))), expected, name);
});

test("removal rules", () => {
  const own = resolveAccess(user(OWNER), m(OWNER, "OWNER"));
  assert.equal(code(() => validateRemoval({ access: own, requestStatus: "DRAFT", member: m(OWNER, "OWNER") })), "CANNOT_REMOVE_OWNER");
  assert.equal(code(() => validateRemoval({ access: own, requestStatus: "PENDING_APPROVAL", member: m(SARA, "APPROVER") })), "LOCKED_WHILE_PENDING");
  assert.equal(code(() => validateRemoval({ access: own, requestStatus: "REJECTED", member: m(SARA, "APPROVER") })), "OK");
});

test("submit rules", () => {
  const req = (o = {}) => ({ id: "R", ownerId: OWNER, status: "DRAFT", approvalRound: 0, version: 1, ...o });
  const ap = (id: string, o = {}) => ({ member: m(id, "APPROVER"), profileActive: true, eligible: true, ...o });
  assert.equal(code(() => validateSubmit({ canEdit: true, request: req(), approvers: [ap(SARA)] })), "OK");
  assert.equal(code(() => validateSubmit({ canEdit: true, request: req(), approvers: [] })), "NO_APPROVERS");
  assert.equal(code(() => validateSubmit({ canEdit: true, request: req(), approvers: [ap(SARA, { eligible: false })] })), "APPROVER_INVALID");
  assert.equal(code(() => validateSubmit({ canEdit: true, request: req({ status: "PENDING_APPROVAL" }), approvers: [ap(SARA)] })), "INVALID_STATE");
  assert.equal(code(() => validateSubmit({ canEdit: false, request: req(), approvers: [ap(SARA)] })), "FORBIDDEN");
});

test("decision authorization has no admin bypass", () => {
  const pend = { id: "R", ownerId: OWNER, status: "PENDING_APPROVAL", approvalRound: 1 };
  const rec = (id: string, decision = "PENDING") => ({ approverId: id, decision, round: 1 });
  const cases: [string, Parameters<typeof authorizeDecision>[0], string][] = [
    ["assigned eligible approver", { caller: sara, request: pend, member: m(SARA, "APPROVER"), record: rec(SARA) }, "OK"],
    ["owner", { caller: user(OWNER, { approvalEligible: true }), request: pend, member: m(OWNER, "OWNER") }, "SELF_APPROVAL"],
    ["participant", { caller: user(PART, { approvalEligible: true }), request: pend, member: m(PART, "PARTICIPANT") }, "SELF_APPROVAL"],
    ["admin owner", { caller: admin, request: { ...pend, ownerId: ADMIN }, member: m(ADMIN, "OWNER") }, "SELF_APPROVAL"],
    ["admin participant", { caller: admin, request: pend, member: m(ADMIN, "PARTICIPANT") }, "SELF_APPROVAL"],
    ["admin not assigned", { caller: admin, request: pend, member: undefined }, "NOT_ASSIGNED"],
    ["admin assigned + eligible", { caller: admin, request: pend, member: m(ADMIN, "APPROVER"), record: rec(ADMIN) }, "OK"],
    ["eligibility alone is not authority", { caller: sara, request: pend, member: undefined }, "NOT_ASSIGNED"],
    ["eligibility revoked", { caller: user(SARA), request: pend, member: m(SARA, "APPROVER"), record: rec(SARA) }, "NOT_ELIGIBLE"],
    ["removed approver", { caller: sara, request: pend, member: m(SARA, "APPROVER", "REMOVED"), record: rec(SARA) }, "NOT_ASSIGNED"],
    ["already decided", { caller: sara, request: pend, member: m(SARA, "APPROVER"), record: rec(SARA, "APPROVED") }, "ALREADY_DECIDED"],
    ["not pending", { caller: sara, request: { ...pend, status: "APPROVED" }, member: m(SARA, "APPROVER"), record: rec(SARA) }, "NOT_PENDING"],
    ["same person, participant in another request", { caller: sara, request: { ...pend, id: "B" }, member: m(SARA, "PARTICIPANT") }, "SELF_APPROVAL"],
    ["same person, owner in another request", { caller: sara, request: { ...pend, id: "C", ownerId: SARA }, member: m(SARA, "OWNER") }, "SELF_APPROVAL"],
  ];
  for (const [name, ctx, expected] of cases) assert.equal(code(() => authorizeDecision(ctx)), expected, name);
});

test("outcomes", () => {
  const rec = (id: string, decision = "PENDING") => ({ approverId: id, decision });
  const recs = [rec("a"), rec("b"), rec("c")];
  const pendingOpen = { requestStatus: "PENDING_APPROVAL", roundStatus: "OPEN", closeOthers: [] };

  // ANY_ONE: one approval is sufficient; a rejection only rejects when it is the last pending decision.
  assert.deepEqual(computeOutcome("ANY_ONE", "APPROVED", "a", recs), { requestStatus: "APPROVED", roundStatus: "APPROVED", closeOthers: ["b", "c"] });
  assert.deepEqual(computeOutcome("ANY_ONE", "REJECTED", "a", recs), pendingOpen, "first rejection keeps the round open");
  assert.deepEqual(computeOutcome("ANY_ONE", "REJECTED", "b", [rec("a", "REJECTED"), rec("b"), rec("c")]), pendingOpen, "second of three rejects: still open");
  assert.deepEqual(computeOutcome("ANY_ONE", "REJECTED", "c", [rec("a", "REJECTED"), rec("b", "REJECTED"), rec("c")]), { requestStatus: "REJECTED", roundStatus: "REJECTED", closeOthers: [] }, "all rejected");
  assert.deepEqual(
    computeOutcome("ANY_ONE", "APPROVED", "c", [rec("a", "REJECTED"), rec("b"), rec("c")]),
    { requestStatus: "APPROVED", roundStatus: "APPROVED", closeOthers: ["b"] },
    "approval after a rejection approves; the rejection stays, only pending records close",
  );
  assert.deepEqual(computeOutcome("ANY_ONE", "REJECTED", "a", [rec("a")]), { requestStatus: "REJECTED", roundStatus: "REJECTED", closeOthers: [] }, "single approver rejects");
  assert.deepEqual(computeOutcome("ANY_ONE", "APPROVED", "a", [rec("a")]), { requestStatus: "APPROVED", roundStatus: "APPROVED", closeOthers: [] }, "single approver approves");
  assert.equal(computeOutcome("ANY_ONE", "REJECTED", "b", [rec("a", "APPROVED"), rec("b")]).requestStatus, "APPROVED", "defensive: an existing approval wins");

  // ALL: unchanged.
  assert.deepEqual(computeOutcome("ALL", "APPROVED", "a", recs), pendingOpen);
  assert.equal(computeOutcome("ALL", "APPROVED", "c", [rec("a", "APPROVED"), rec("b", "APPROVED"), rec("c")]).requestStatus, "APPROVED");
  assert.deepEqual(computeOutcome("ALL", "REJECTED", "b", [rec("a", "APPROVED"), rec("b"), rec("c")]), { requestStatus: "REJECTED", roundStatus: "REJECTED", closeOthers: ["c"] });
  assert.deepEqual(computeOutcome("ALL", "REJECTED", "a", recs), { requestStatus: "REJECTED", roundStatus: "REJECTED", closeOthers: ["b", "c"] }, "first rejection rejects");
  assert.deepEqual(computeOutcome("ALL", "REJECTED", "a", [rec("a")]), { requestStatus: "REJECTED", roundStatus: "REJECTED", closeOthers: [] });
});

test("input parsing", () => {
  assert.equal(code(() => parseDecisionBody({ decision: "REJECTED" })), "VALIDATION_ERROR");
  assert.equal(code(() => parseDecisionBody({ decision: "REJECTED", comment: "   " })), "VALIDATION_ERROR");
  assert.equal(code(() => parseDecisionBody({ decision: "APPROVED" })), "OK");
  assert.equal(code(() => parseDecisionBody({ decision: "APPROVED", comment: "x".repeat(1001) })), "VALIDATION_ERROR");
  assert.equal(code(() => parseDecisionBody({ decision: "MAYBE" })), "VALIDATION_ERROR");
  assert.equal(code(() => parseWithdrawBody({ version: 1 })), "VALIDATION_ERROR");
  assert.equal(code(() => parseWithdrawBody({ reason: "approver left" })), "VALIDATION_ERROR");
  assert.equal(code(() => parseWithdrawBody({ reason: "approver left", version: 2 })), "OK");
});

test("withdraw rules", () => {
  assert.equal(code(() => validateWithdraw({ canEdit: true, request: { status: "PENDING_APPROVAL" } })), "OK");
  assert.equal(code(() => validateWithdraw({ canEdit: false, request: { status: "PENDING_APPROVAL" } })), "FORBIDDEN");
  assert.equal(code(() => validateWithdraw({ canEdit: true, request: { status: "DRAFT" } })), "NOT_PENDING");
});

test("C1 regression: decision record update aliases every attribute name", () => {
  const u = decisionRecordUpdate({
    requestId: "R", round: 1, approverId: SARA, submittedAt: "2026-11-12T00:00:00.000Z", decision: "REJECTED", now: "2026-11-12T01:00:00.000Z",
    extra: { comment: "Not enough detail", decidedBy: SARA, skipped: undefined },
  });
  assert.deepEqual(reservedWordsIn(u.UpdateExpression), []);
  assert.deepEqual(reservedWordsIn(u.ConditionExpression), []);
  assert.ok(Object.values(u.ExpressionAttributeNames).includes("comment"), "comment is written through an alias");
  assert.ok(!/\bcomment\b/.test(u.UpdateExpression), "no raw `comment` in the expression");
  assert.ok(!Object.values(u.ExpressionAttributeNames).includes("skipped"), "undefined extras are skipped");
  assert.equal(u.ExpressionAttributeValues[":gsk"], "REJECTED#2026-11-12T00:00:00.000Z#R");
});

test("reserved-word lint itself", () => {
  assert.deepEqual(reservedWordsIn("SET decision = :d, comment = :c"), ["comment"]);
  assert.deepEqual(reservedWordsIn("SET #s = :s, membersRev = if_not_exists(membersRev, :z) + :one"), []);
  assert.deepEqual(reservedWordsIn("attribute_exists(PK) AND NOT (#s IN (:a, :b))"), []);
});

test("transaction size guard", async () => {
  const dummy = Array.from({ length: MAX_TRANSACTION_ITEMS + 1 }, () => ({ ConditionCheck: { TableName: "t", Key: { PK: "x", SK: "y" }, ConditionExpression: "attribute_exists(PK)" } }));
  await assert.rejects(transact(dummy as any), (e: any) => e.code === "TRANSACTION_TOO_LARGE");
  assert.ok(1 + 1 + MAX_APPROVERS + 1 + 2 <= MAX_TRANSACTION_ITEMS);
});
