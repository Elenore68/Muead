import type { Item } from "./db";

/*
 * Notification rules (TASK 05). Pure functions only: easy to test, no AWS calls.
 *
 * Source: every state change already writes an append-only AUDIT item under the request. The notifier Lambda
 * (handlers/notifier.ts) reads those inserts from the DynamoDB stream and turns them into notifications here.
 *
 * Rules that apply to every event:
 *  - The actor is never notified about their own action.
 *  - Recipients must be ACTIVE members of the request at processing time (activity-scoped, no global roles).
 *    The only exception is the person who was just removed, who is told once that they lost access.
 *  - Minor field edits (REQUEST_UPDATED) produce no notification.
 *  - Notifications carry only what the recipient may already see: request number, title, who did what.
 *    Comments, reasons and other request content stay in the request (approval history).
 */
export type NotificationType =
  | "REQUEST_CREATED"
  | "MEMBER_ASSIGNED"
  | "MEMBER_REMOVED"
  | "REQUEST_SUBMITTED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_DECISION_RECORDED"
  | "REQUEST_APPROVED"
  | "REQUEST_REJECTED"
  | "REQUEST_WITHDRAWN"
  | "REQUEST_STATUS_CHANGED"
  | "TASK_ASSIGNED"
  | "TASK_COMPLETED"
  | "READINESS_UPDATED"
  | "MAINTENANCE_COMPLETED"
  | "VALIDATION_COMPLETED"
  | "FINAL_REPORT_AVAILABLE";

/**
 * Audit actions that will be written by features not built yet (tasks, readiness, execution, validation,
 * reports, status transitions). The rules exist and are tested, so those features only need to write the audit
 * entry with the fields listed in api-specification.md 13.2.
 */
export const RESERVED_ACTIONS = [
  "REQUEST_STATUS_CHANGED",
  "TASK_ASSIGNED",
  "TASK_COMPLETED",
  "READINESS_UPDATED",
  "MAINTENANCE_COMPLETED",
  "VALIDATION_COMPLETED",
  "FINAL_REPORT_AVAILABLE",
] as const;

export interface MemberLite {
  userId: string;
  activityRole: "OWNER" | "PARTICIPANT" | "APPROVER";
  status: "ACTIVE" | "REMOVED";
}

export interface RequestLite {
  id: string;
  requestNo: string;
  title: string;
  ownerId: string;
}

export interface Planned {
  recipientId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** false when the recipient no longer has access (removal): the UI shows no link. */
  linkToRequest: boolean;
}

const STATUS_WORDS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SCHEDULED: "Scheduled",
  READINESS: "Readiness",
  IN_PROGRESS: "In progress",
  VALIDATION: "Validation",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};
const roleWord = (r: unknown) => (r === "APPROVER" ? "an approver" : r === "PARTICIPANT" ? "a participant" : "a member");

/**
 * Who gets what for one audit entry. `members` = all member items of the request (any status).
 * Returns at most one notification per recipient.
 */
export const planNotifications = (audit: Item, request: RequestLite, members: MemberLite[]): Planned[] => {
  const actorId: string = audit.actorId;
  const actor: string = audit.actorName || "Someone";
  const ref = `${request.requestNo} – ${request.title}`;
  const active = members.filter((m) => m.status === "ACTIVE");
  const activeIds = new Set(active.map((m) => m.userId));
  const byRole = (...roles: MemberLite["activityRole"][]) => active.filter((m) => roles.includes(m.activityRole)).map((m) => m.userId);

  const out = new Map<string, Planned>();
  /** Adds a recipient if allowed. `requireActive=false` only for the removed person. */
  const add = (ids: (string | undefined)[], type: NotificationType, title: string, body: string, opts: { requireActive?: boolean; link?: boolean } = {}) => {
    for (const id of ids) {
      if (!id || id === actorId || out.has(id)) continue;
      if (opts.requireActive !== false && !activeIds.has(id)) continue;
      out.set(id, { recipientId: id, type, title, body, linkToRequest: opts.link !== false });
    }
  };
  const owner = request.ownerId;

  switch (audit.action) {
    case "REQUEST_CREATED":
      // The creator is the owner, so normally nobody else is told. Kept for a future "created on behalf of".
      add([owner], "REQUEST_CREATED", "Request created", `${actor} created ${ref}.`);
      break;

    case "MEMBER_ADDED":
    case "APPROVER_ASSIGNED": {
      const role = audit.targetActivityRole ?? (audit.action === "APPROVER_ASSIGNED" ? "APPROVER" : "PARTICIPANT");
      const extra = role === "APPROVER" ? " You will be asked to decide once it is submitted." : "";
      add([audit.targetUserId], "MEMBER_ASSIGNED", `You were added to ${request.requestNo}`, `${actor} added you as ${roleWord(role)} on ${ref}.${extra}`);
      // An admin changed someone else's request: tell the owner.
      add([owner], "MEMBER_ASSIGNED", `Member added to ${request.requestNo}`, `${actor} added ${audit.targetName ?? "someone"} as ${roleWord(role)}.`);
      break;
    }

    case "MEMBER_REMOVED":
    case "APPROVER_REMOVED":
      add([audit.targetUserId], "MEMBER_REMOVED", `You were removed from ${request.requestNo}`, `${actor} removed you from ${ref}.`, { requireActive: false, link: false });
      add([owner], "MEMBER_REMOVED", `Member removed from ${request.requestNo}`, `${actor} removed ${audit.targetName ?? "someone"}.`);
      break;

    case "SUBMITTED_FOR_APPROVAL": {
      const approvers = Array.isArray(audit.approvers) ? audit.approvers.map((a: Item) => a.userId) : byRole("APPROVER");
      add(approvers, "APPROVAL_REQUIRED", `Approval required: ${request.requestNo}`, `${actor} submitted ${ref} for your approval.`);
      add([owner, ...byRole("PARTICIPANT")], "REQUEST_SUBMITTED", `${request.requestNo} submitted`, `${actor} submitted ${ref} for approval.`);
      break;
    }

    case "APPROVAL_DECIDED": {
      const result = audit.resultingRequestStatus;
      const did = audit.decision === "REJECTED" ? "rejected" : "approved";
      if (result === "APPROVED" || result === "REJECTED") {
        const type = result === "APPROVED" ? "REQUEST_APPROVED" : "REQUEST_REJECTED";
        const word = result === "APPROVED" ? "approved" : "rejected";
        add([owner, ...byRole("PARTICIPANT", "APPROVER")], type, `${request.requestNo} ${word}`, `${ref} was ${word} (last decision by ${actor}). See the approval history for details.`);
      } else {
        // Round still open: only the owner needs to know (ANY_ONE rejection with others pending, ALL partial approval).
        add([owner], "APPROVAL_DECISION_RECORDED", `${actor} ${did} ${request.requestNo}`, `${actor} ${did} ${ref}. The request is still waiting for other approvers.`);
      }
      break;
    }

    case "REQUEST_WITHDRAWN": {
      const closed: string[] = Array.isArray(audit.closedRecords) ? audit.closedRecords : [];
      add([...closed, ...byRole("PARTICIPANT")], "REQUEST_WITHDRAWN", `${request.requestNo} withdrawn`, `${actor} withdrew ${ref} from approval. No decision is needed now.`);
      add([owner], "REQUEST_WITHDRAWN", `${request.requestNo} withdrawn`, `${actor} withdrew ${ref} from approval.`);
      break;
    }

    /* ---------------- reserved: emitted by features that are not built yet ---------------- */
    case "REQUEST_STATUS_CHANGED": {
      const to = STATUS_WORDS[audit.toStatus] ?? audit.toStatus ?? "a new status";
      add(active.map((m) => m.userId), "REQUEST_STATUS_CHANGED", `${request.requestNo}: ${to}`, `${actor} moved ${ref} to ${to}.`);
      break;
    }
    case "TASK_ASSIGNED":
      add([audit.assigneeId], "TASK_ASSIGNED", `Task assigned: ${audit.taskTitle ?? "new task"}`, `${actor} assigned you a task on ${ref}.`);
      break;
    case "TASK_COMPLETED":
      add([owner, audit.assignedBy], "TASK_COMPLETED", `Task completed: ${audit.taskTitle ?? "task"}`, `${actor} completed a task on ${ref}.`);
      break;
    case "READINESS_UPDATED":
      add([owner], "READINESS_UPDATED", `Readiness updated: ${request.requestNo}`, `${actor} updated the readiness checklist of ${ref}.`);
      break;
    case "MAINTENANCE_COMPLETED":
      add(active.map((m) => m.userId), "MAINTENANCE_COMPLETED", `Maintenance completed: ${request.requestNo}`, `${actor} marked the maintenance of ${ref} as completed.`);
      break;
    case "VALIDATION_COMPLETED":
      add([owner, ...byRole("PARTICIPANT")], "VALIDATION_COMPLETED", `Validation completed: ${request.requestNo}`, `${actor} completed post-maintenance validation for ${ref}.`);
      break;
    case "FINAL_REPORT_AVAILABLE":
      add(active.map((m) => m.userId), "FINAL_REPORT_AVAILABLE", `Final report available: ${request.requestNo}`, `The final report for ${ref} is available.`);
      break;

    default:
      // REQUEST_UPDATED (minor edits) and anything unknown: no notification.
      break;
  }
  return [...out.values()];
};

/* ------------------------------------------------------------------ storage */
export const NOTIFICATION_TTL_DAYS = 180;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export const isNotificationId = (id: string) => ULID.test(id);

/** Audit SK is AUDIT#<at>#<ulid>; the ulid becomes the notification id (time-sortable, idempotent per recipient). */
export const notificationIdFromAudit = (auditSk: string): string | undefined => {
  const id = auditSk.split("#").pop() ?? "";
  return ULID.test(id) ? id : undefined;
};

export const notificationKey = (userId: string, id: string) => ({ PK: `USER#${userId}`, SK: `NOTIF#${id}` });

export const buildNotification = (p: { planned: Planned; id: string; request: RequestLite; audit: Item; now: Date; emailStatus: string }): Item => ({
  ...notificationKey(p.planned.recipientId, p.id),
  entityType: "NOTIFICATION",
  id: p.id,
  recipientId: p.planned.recipientId,
  type: p.planned.type,
  title: p.planned.title,
  body: p.planned.body,
  requestId: p.request.id,
  requestNo: p.request.requestNo,
  linkToRequest: p.planned.linkToRequest,
  actorId: p.audit.actorId,
  actorName: p.audit.actorName,
  sourceAction: p.audit.action,
  createdAt: p.audit.at ?? p.now.toISOString(),
  emailStatus: p.emailStatus,
  ttl: Math.floor(p.now.getTime() / 1000) + NOTIFICATION_TTL_DAYS * 86_400,
});

export const toNotificationApi = (n: Item) => ({
  id: n.id,
  type: n.type,
  title: n.title,
  body: n.body,
  requestId: n.linkToRequest === false ? null : n.requestId,
  requestNo: n.requestNo,
  createdAt: n.createdAt,
  readAt: n.readAt ?? null,
});
