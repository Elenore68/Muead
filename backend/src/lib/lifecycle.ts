import { ApiError, badRequest } from "./errors";
import type { Item } from "./db";
import type { Status } from "./requests";

/**
 * Request lifecycle after approval (TASK 06, confirmed decisions in PROJECT-HANDOVER.md 14.1):
 *   Draft -> Pending Approval -> Approved -> Scheduled -> Readiness -> In Progress -> Validation -> Completed
 * Draft -> Pending Approval / Approved / Rejected are owned by the approval workflow (lib/approvals.ts).
 * This module owns the steps after Approved, and Cancel. Everything here is pure.
 */

/** The only forward step from each status (Approved stays a visible, separate status). */
export const NEXT_STATUS: Partial<Record<Status, Status>> = {
  APPROVED: "SCHEDULED",
  SCHEDULED: "READINESS",
  READINESS: "IN_PROGRESS",
  IN_PROGRESS: "VALIDATION",
  VALIDATION: "COMPLETED",
};

/**
 * Cancel is allowed before execution starts. PENDING_APPROVAL is excluded on purpose: withdraw first, so the open
 * approval round is closed properly. IN_PROGRESS and later cannot be cancelled (suggested rule, 14.2).
 */
export const CANCELLABLE: Status[] = ["DRAFT", "REJECTED", "APPROVED", "SCHEDULED", "READINESS"];

export const MAX_CANCEL_REASON = 1000;

export const nextStatusOf = (status: string): Status | undefined => NEXT_STATUS[status as Status];

/** Attributes written on the request for a given step (timestamps only; the caller adds updatedAt/version). */
export const transitionAttrs = (to: Status, now: string, actorId: string, reason?: string): Item => {
  switch (to) {
    case "SCHEDULED":
      return { scheduledAt: now, scheduledBy: actorId };
    case "READINESS":
      return { readinessStartedAt: now };
    case "IN_PROGRESS":
      return { startedAt: now, startedBy: actorId };
    case "VALIDATION":
      return { validationStartedAt: now };
    case "COMPLETED":
      return { completedAt: now, completedBy: actorId };
    case "CANCELLED":
      return { cancelledAt: now, cancelledBy: actorId, cancelReason: reason };
    default:
      return {};
  }
};

export interface TransitionBody {
  to: Status;
  version: number;
}

export const parseTransitionBody = (body: Record<string, unknown>): TransitionBody => {
  if (typeof body.version !== "number" || !Number.isInteger(body.version)) {
    throw badRequest("version is required", [{ field: "version", issue: "required" }]);
  }
  if (typeof body.to !== "string" || !body.to) throw badRequest("to is required", [{ field: "to", issue: "required" }]);
  return { to: body.to as Status, version: body.version };
};

export const parseCancelBody = (body: Record<string, unknown>): { reason: string; version: number } => {
  if (typeof body.version !== "number" || !Number.isInteger(body.version)) {
    throw badRequest("version is required", [{ field: "version", issue: "required" }]);
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) throw badRequest("reason is required", [{ field: "reason", issue: "required" }]);
  if (reason.length > MAX_CANCEL_REASON) throw badRequest(`reason is too long (max ${MAX_CANCEL_REASON})`, [{ field: "reason", issue: "max_length" }]);
  return { reason, version: body.version };
};

/**
 * Owner or platform admin only (`canEdit`), only along the lifecycle, only from the previous status.
 * Moving to SCHEDULED needs a start date (a schedule without a date is not a schedule).
 */
export const validateTransition = (p: { canEdit: boolean; request: Item; to: Status }): void => {
  if (!p.canEdit) throw new ApiError(403, "FORBIDDEN", "Only the owner of this request can change its status");
  const from = p.request.status as Status;
  const allowed = NEXT_STATUS[from];
  if (!allowed) {
    throw new ApiError(409, "INVALID_TRANSITION", `A request in status ${from} cannot be moved forward`);
  }
  if (p.to !== allowed) {
    throw new ApiError(409, "INVALID_TRANSITION", `From ${from} a request can only move to ${allowed}`);
  }
  if (p.to === "SCHEDULED" && !p.request.scheduleStart) {
    throw new ApiError(400, "SCHEDULE_REQUIRED", "Set a schedule start date before scheduling the request", [{ field: "schedule.start", issue: "required" }]);
  }
};

export const validateCancel = (p: { canEdit: boolean; request: Item }): void => {
  if (!p.canEdit) throw new ApiError(403, "FORBIDDEN", "Only the owner of this request can cancel it");
  const from = p.request.status as Status;
  if (from === "CANCELLED") throw new ApiError(409, "INVALID_TRANSITION", "The request is already cancelled");
  if (from === "PENDING_APPROVAL") throw new ApiError(409, "INVALID_TRANSITION", "Withdraw the request from approval before cancelling it");
  if (!CANCELLABLE.includes(from)) throw new ApiError(409, "INVALID_TRANSITION", `A request in status ${from} cannot be cancelled`);
};

/** What the UI may offer to the caller right now (the backend re-checks on every call). */
export const availableActions = (status: string, canEdit: boolean): { next: Status | null; canCancel: boolean } => ({
  next: canEdit ? nextStatusOf(status) ?? null : null,
  canCancel: canEdit && CANCELLABLE.includes(status as Status),
});

/* ------------------------------------------------------------------ required fields at submit */
/** Fields that must be filled before a request can be sent for approval. */
export const REQUIRED_AT_SUBMIT = ["environment", "cloudPlatform", "maintenanceType", "scheduleStart"] as const;
const FIELD_LABEL: Record<string, string> = {
  environment: "environment",
  cloudPlatform: "cloudPlatform",
  maintenanceType: "maintenanceType",
  scheduleStart: "schedule.start",
};

export const validateSubmitFields = (request: Item): void => {
  const missing = REQUIRED_AT_SUBMIT.filter((k) => !request[k]);
  if (missing.length) {
    throw new ApiError(
      400,
      "REQUEST_INCOMPLETE",
      `Complete these fields before submitting: ${missing.map((k) => FIELD_LABEL[k]).join(", ")}`,
      missing.map((k) => ({ field: FIELD_LABEL[k], issue: "required" })),
    );
  }
};

/* ------------------------------------------------------------------ dropdown values */
export const ENVIRONMENTS = ["Development", "Testing", "Staging", "Production", "Disaster Recovery"] as const;
export const CLOUD_PLATFORMS = ["AWS", "Azure", "Google Cloud", "Hybrid", "Other"] as const;
export const MAINTENANCE_TYPES = [
  "Planned Maintenance",
  "Emergency Maintenance",
  "Preventive Maintenance",
  "Corrective Maintenance",
  "Upgrade",
  "Patching",
] as const;
