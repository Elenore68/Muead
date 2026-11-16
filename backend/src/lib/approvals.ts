import type { Caller } from "./auth";
import { TABLE, type Item } from "./db";
import { ApiError, badRequest } from "./errors";
import { isActive, MAX_APPROVERS } from "./members";

/**
 * Approval rounds (database-design.md 3.6).
 *   PK=REQ#<id>  SK=APPRROUND#<round>              round header: policy, status, approver ids, who submitted
 *   PK=REQ#<id>  SK=APPR#<round>#<approverId>      one decision record per assigned approver (snapshot names)
 *     GSI3PK=APPROVER#<approverId>  GSI3SK=<decision>#<submittedAt>#<requestId>   -> personal inbox per decision
 * Records are never deleted; a resubmission creates round + 1.
 *
 * Transaction sizes (DynamoDB max 100 items):
 *   submit   = request + round + approvers (<= MAX_APPROVERS) + audit + 2 stats  <= 25
 *   decision = request + round + approvers (<= MAX_APPROVERS) + audit + 2 stats  <= 25
 */
export const POLICIES = ["ANY_ONE", "ALL"] as const;
export type Policy = (typeof POLICIES)[number];
export const DEFAULT_POLICY: Policy = "ANY_ONE";

export const DECISIONS = ["PENDING", "APPROVED", "REJECTED", "NOT_REQUIRED"] as const;
export type Decision = (typeof DECISIONS)[number];

export const MAX_COMMENT = 1000;

export const roundStr = (n: number) => String(n).padStart(4, "0");
export const roundKey = (requestId: string, round: number) => ({ PK: `REQ#${requestId}`, SK: `APPRROUND#${roundStr(round)}` });
export const recordKey = (requestId: string, round: number, approverId: string) => ({
  PK: `REQ#${requestId}`,
  SK: `APPR#${roundStr(round)}#${approverId}`,
});
export const inboxSK = (decision: Decision, submittedAt: string, requestId: string) => `${decision}#${submittedAt}#${requestId}`;

export const policyOf = (r: Item): Policy => ((POLICIES as readonly string[]).includes(r.approvalPolicy) ? r.approvalPolicy : DEFAULT_POLICY);

/* ------------------------------------------------------------------ submit (pure) */
export interface ApproverCheck {
  member: Item;
  profileActive: boolean;
  /** ApprovalEligible mirror at submit time. */
  eligible: boolean;
}

export const validateSubmit = (p: { canEdit: boolean; request: Item; approvers: ApproverCheck[] }): void => {
  if (!p.canEdit) throw new ApiError(403, "FORBIDDEN", "Only the owner of this request can submit it");
  if (p.request.status !== "DRAFT" && p.request.status !== "REJECTED") {
    throw new ApiError(409, "INVALID_STATE", `A request in status ${p.request.status} cannot be submitted`);
  }
  if (p.approvers.length === 0) throw new ApiError(400, "NO_APPROVERS", "Assign at least one approver before submitting");
  if (p.approvers.length > MAX_APPROVERS) throw new ApiError(409, "APPROVER_LIMIT", `A request can have at most ${MAX_APPROVERS} approvers`);
  const problems: { field: string; issue: string }[] = [];
  for (const a of p.approvers) {
    const who = a.member.userId as string;
    if (a.member.activityRole !== "APPROVER" || !isActive(a.member)) problems.push({ field: who, issue: "not_an_active_approver" });
    else if (who === p.request.ownerId) problems.push({ field: who, issue: "owner_cannot_approve" });
    else if (!a.profileActive) problems.push({ field: who, issue: "user_inactive" });
    else if (!a.eligible) problems.push({ field: who, issue: "not_approval_eligible" });
  }
  if (problems.length) {
    throw new ApiError(409, "APPROVER_INVALID", "Some assigned approvers can no longer approve. Update the approvers and submit again.", problems);
  }
};

/* ------------------------------------------------------------------ decision authorization (pure) */
export interface DecisionContext {
  caller: Caller;
  request: Item;
  /** Caller's member item for this request (any status). */
  member?: Item;
  /** Caller's decision record for the CURRENT round, if assigned. */
  record?: Item;
}

/**
 * All checks, no exception for platform admins (decisions 5 and the self-approval rule).
 * Ordered so the most specific reason is reported.
 */
export const authorizeDecision = (c: DecisionContext): void => {
  if (c.request.status !== "PENDING_APPROVAL") throw new ApiError(409, "NOT_PENDING", "This request is not waiting for approval");
  if (c.caller.userId === c.request.ownerId) throw new ApiError(403, "SELF_APPROVAL", "You cannot approve or reject your own request");
  if (isActive(c.member) && c.member.activityRole === "PARTICIPANT") {
    throw new ApiError(403, "SELF_APPROVAL", "Participants of this activity cannot approve or reject it");
  }
  if (!isActive(c.member) || c.member.activityRole !== "APPROVER" || !c.record) {
    throw new ApiError(403, "NOT_ASSIGNED", "You are not an assigned approver for the current approval round");
  }
  if (!c.caller.approvalEligible) throw new ApiError(403, "NOT_ELIGIBLE", "You are no longer in the ApprovalEligible group");
  if (c.record.decision !== "PENDING") throw new ApiError(409, "ALREADY_DECIDED", "You have already decided on this round");
};

/** true/false + reason code, for inbox rows. */
export const canDecide = (c: DecisionContext): { ok: boolean; reason: string | null } => {
  try {
    authorizeDecision(c);
    return { ok: true, reason: null };
  } catch (e) {
    return { ok: false, reason: e instanceof ApiError ? e.code : "UNKNOWN" };
  }
};

/* ------------------------------------------------------------------ outcome (pure) */
export interface Outcome {
  requestStatus: "APPROVED" | "REJECTED" | "PENDING_APPROVAL";
  roundStatus: "APPROVED" | "REJECTED" | "OPEN";
  /** Approver ids whose PENDING records become NOT_REQUIRED. */
  closeOthers: string[];
}

/**
 * Outcome of one decision, given all decision records of the CURRENT round as read before it.
 *
 * ANY_ONE (one approval is sufficient):
 *   - approve -> request APPROVED at once; every other still-PENDING record becomes NOT_REQUIRED.
 *     Earlier REJECTED records stay REJECTED (history is never rewritten).
 *   - reject  -> recorded; the request stays PENDING_APPROVAL while any other approver is still PENDING,
 *     because one of them may still approve. It is REJECTED only when every assigned approver has rejected,
 *     i.e. this rejection is the last pending decision.
 * ALL (every approver must approve):
 *   - reject  -> request REJECTED at once; other PENDING records become NOT_REQUIRED.
 *   - approve -> APPROVED only when every other approver has approved; otherwise the round stays OPEN.
 *
 * Concurrency: callers must read `records` with strongly consistent reads and commit under the request's
 * version condition (see handlers/approvals.ts `decide`), so two "last" decisions cannot both see the other
 * as pending and both commit a non-final outcome.
 */
export const computeOutcome = (policy: Policy, decision: "APPROVED" | "REJECTED", deciderId: string, records: Item[]): Outcome => {
  const others = records.filter((r) => r.approverId !== deciderId);
  const othersPending = others.filter((r) => r.decision === "PENDING").map((r) => r.approverId as string);

  if (policy === "ANY_ONE") {
    // Defensive: an approval always closes an ANY_ONE round in the same transaction, so an APPROVED record
    // in an open round cannot happen. If it ever did, the request has been approved by someone.
    if (decision === "APPROVED" || others.some((r) => r.decision === "APPROVED")) {
      return { requestStatus: "APPROVED", roundStatus: "APPROVED", closeOthers: othersPending };
    }
    // Rejection: keep the round open while anyone can still approve.
    if (othersPending.length > 0) return { requestStatus: "PENDING_APPROVAL", roundStatus: "OPEN", closeOthers: [] };
    // Nobody left to decide and nobody approved: every assigned approver has rejected.
    return { requestStatus: "REJECTED", roundStatus: "REJECTED", closeOthers: [] };
  }

  // ALL
  if (decision === "REJECTED" || others.some((r) => r.decision === "REJECTED")) {
    return { requestStatus: "REJECTED", roundStatus: "REJECTED", closeOthers: othersPending };
  }
  if (others.every((r) => r.decision === "APPROVED")) return { requestStatus: "APPROVED", roundStatus: "APPROVED", closeOthers: [] };
  return { requestStatus: "PENDING_APPROVAL", roundStatus: "OPEN", closeOthers: [] };
};

/* ------------------------------------------------------------------ record update (pure) */
/**
 * Update for one decision record, conditioned on it still being PENDING.
 * EVERY attribute name goes through ExpressionAttributeNames: several names we store are DynamoDB reserved
 * words (for example `comment`; review finding C1), so raw names must never be interpolated into expressions.
 */
export const decisionRecordUpdate = (p: {
  requestId: string;
  round: number;
  approverId: string;
  submittedAt: string;
  decision: Decision;
  now: string;
  extra?: Record<string, unknown>;
}) => {
  const names: Record<string, string> = { "#dec": "decision", "#at": "decidedAt", "#gsk": "GSI3SK" };
  const values: Record<string, unknown> = {
    ":dec": p.decision,
    ":pending": "PENDING",
    ":at": p.now,
    ":gsk": inboxSK(p.decision, p.submittedAt, p.requestId),
  };
  const sets = ["#dec = :dec", "#at = :at", "#gsk = :gsk"];
  Object.entries(p.extra ?? {})
    .filter(([, v]) => v !== undefined)
    .forEach(([k, v], i) => {
      names[`#x${i}`] = k;
      values[`:x${i}`] = v;
      sets.push(`#x${i} = :x${i}`);
    });
  return {
    TableName: TABLE,
    Key: recordKey(p.requestId, p.round, p.approverId),
    UpdateExpression: `SET ${sets.join(", ")}`,
    ConditionExpression: "#dec = :pending",
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  };
};

/* ------------------------------------------------------------------ withdraw (pure) */
export const MAX_REASON = 1000;

/** Owner or platform admin pulls a PENDING request back to DRAFT (recovery for unresponsive or departed approvers). */
export const validateWithdraw = (p: { canEdit: boolean; request: Item }): void => {
  if (!p.canEdit) throw new ApiError(403, "FORBIDDEN", "Only the owner of this request or a platform admin can withdraw it");
  if (p.request.status !== "PENDING_APPROVAL") throw new ApiError(409, "NOT_PENDING", "Only a request waiting for approval can be withdrawn");
};

export const parseWithdrawBody = (body: Record<string, unknown>): { reason: string; version: number } => {
  if (typeof body.version !== "number" || !Number.isInteger(body.version)) throw badRequest("version is required", [{ field: "version", issue: "required" }]);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) throw badRequest("A reason is required when withdrawing", [{ field: "reason", issue: "required" }]);
  if (reason.length > MAX_REASON) throw badRequest(`reason is too long (max ${MAX_REASON})`, [{ field: "reason", issue: "max_length" }]);
  return { reason, version: body.version };
};

/* ------------------------------------------------------------------ input parsing */
export const parseDecisionBody = (body: Record<string, unknown>): { decision: "APPROVED" | "REJECTED"; comment?: string } => {
  const d = body.decision;
  if (d !== "APPROVED" && d !== "REJECTED") throw badRequest("decision must be APPROVED or REJECTED", [{ field: "decision", issue: "enum" }]);
  let comment: string | undefined;
  if (body.comment !== undefined && body.comment !== null) {
    if (typeof body.comment !== "string") throw badRequest("comment must be a string", [{ field: "comment", issue: "type" }]);
    comment = body.comment.trim() || undefined;
    if (comment && comment.length > MAX_COMMENT) throw badRequest(`comment is too long (max ${MAX_COMMENT})`, [{ field: "comment", issue: "max_length" }]);
  }
  if (d === "REJECTED" && !comment) throw badRequest("A comment is required when rejecting", [{ field: "comment", issue: "required" }]);
  return { decision: d, comment };
};
