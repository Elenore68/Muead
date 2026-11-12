import { api } from "./client";
import type { ApiPriority, ApiStatus } from "./requests";

/*
 * Approval endpoints (docs/backend/api-specification.md 3.3, 3.8, 12.2).
 * The backend enforces every rule again; the UI only hides controls the caller cannot use.
 */
export type ApprovalPolicy = "ANY_ONE" | "ALL";
export type Decision = "PENDING" | "APPROVED" | "REJECTED" | "NOT_REQUIRED";
export type InboxDecision = Exclude<Decision, "NOT_REQUIRED">;
export type RoundStatus = "OPEN" | "APPROVED" | "REJECTED" | "WITHDRAWN";

/** Backend limits (lib/approvals.ts MAX_COMMENT, MAX_REASON). */
export const MAX_COMMENT = 1000;
export const MAX_REASON = 1000;

export interface ApprovalItem {
  approvalId: string;
  requestId: string;
  requestNo: string;
  title: string;
  description: string;
  requestedBy: { id: string; displayName: string; initials: string };
  category: string | null;
  priority: ApiPriority | null;
  round: number;
  policy: ApprovalPolicy;
  decision: Decision;
  comment: string | null;
  submittedAt: string;
  decidedAt: string | null;
  requestStatus: ApiStatus | null;
  canDecide: boolean;
  blockedReason: string | null;
}

export interface ApprovalSummary {
  pending: number;
  approved: number;
  rejected: number;
}

export interface ApprovalRound {
  round: number;
  policy: ApprovalPolicy;
  status: RoundStatus;
  submittedAt: string;
  submittedBy: { id: string; displayName: string; activityRole: string };
  decidedAt: string | null;
  approvers: {
    userId: string;
    displayName: string;
    initials: string;
    activityRole: string;
    decision: Decision;
    comment: string | null;
    decidedAt: string | null;
  }[];
}

export interface ApprovalHistory {
  approvalState: string;
  approvalPolicy: ApprovalPolicy;
  currentRound: number;
  rounds: ApprovalRound[];
}

export interface DecisionResult {
  requestId: string;
  round: number;
  decision: "APPROVED" | "REJECTED";
  requestStatus: ApiStatus;
  roundStatus: RoundStatus;
  version: number;
}

const enc = encodeURIComponent;

export const listApprovals = (p: { decision: InboxDecision; q?: string; limit: number; nextToken?: string }, signal?: AbortSignal) =>
  api<{ items: ApprovalItem[]; nextToken: string | null }>("approvals", { query: p, signal });

export const getApprovalSummary = (signal?: AbortSignal) => api<ApprovalSummary>("approvals/summary", { signal });

export const getApprovalHistory = (requestId: string, signal?: AbortSignal) =>
  api<ApprovalHistory>(`requests/${enc(requestId)}/approvals`, { signal });

/** `comment` is required by the backend when rejecting (max 1000), optional when approving. No version is sent. */
export const decide = (requestId: string, decision: "APPROVED" | "REJECTED", comment?: string) =>
  api<DecisionResult>(`requests/${enc(requestId)}/approvals/decision`, {
    method: "POST",
    body: { decision, ...(comment ? { comment } : {}) },
  });

export const submitRequest = (requestId: string, version: number) =>
  api<{ requestId: string; status: ApiStatus; approvalRound: number; approvalPolicy: ApprovalPolicy; approvers: number; version: number }>(
    `requests/${enc(requestId)}/submit`,
    { method: "POST", body: { version } },
  );

export const withdrawRequest = (requestId: string, reason: string, version: number) =>
  api<{ requestId: string; status: ApiStatus; approvalState: string; round: number; closedRecords: number; version: number }>(
    `requests/${enc(requestId)}/withdraw`,
    { method: "POST", body: { reason, version } },
  );

/** PATCH /requests/{id} with only `approvalPolicy` (allowed in DRAFT / REJECTED, owner or admin). */
export const setApprovalPolicy = (requestId: string, approvalPolicy: ApprovalPolicy, version: number) =>
  api<{ version: number; approvalPolicy: ApprovalPolicy }>(`requests/${enc(requestId)}`, {
    method: "PATCH",
    body: { approvalPolicy, version },
  });
