import type { ApiPriority, ApiStatus } from "./requests";

/** API enum -> label shown in the existing UI. Statuses with no designed pill reuse existing pill colours. */
export const statusLabel = (s: ApiStatus): string =>
  ({
    DRAFT: "Draft",
    PENDING_APPROVAL: "Pending",
    APPROVED: "Approved",
    REJECTED: "Rejected",
    SCHEDULED: "Scheduled",
    READINESS: "In Progress",
    IN_PROGRESS: "In Progress",
    VALIDATION: "In Progress",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
  })[s] ?? s;

export const priorityLabel = (p: ApiPriority | null): string | null => (p ? p[0] + p.slice(1).toLowerCase() : null);

export const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/* ---------- TASK 04b: activity roles and approvals ---------- */
export const activityRoleLabel = (r: string | null | undefined): string =>
  ({ OWNER: "Owner", PARTICIPANT: "Participant", APPROVER: "Approver", PLATFORM_ADMIN: "Platform admin" })[r ?? ""] ?? "—";

/** Decision -> label. "Pending" / "Approved" / "Rejected" reuse the existing status pill colours. */
export const decisionLabel = (d: string): string =>
  ({ PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected", NOT_REQUIRED: "Not required" })[d] ?? d;

export const roundStatusLabel = (s: string): string =>
  ({ OPEN: "Open", APPROVED: "Approved", REJECTED: "Rejected", WITHDRAWN: "Withdrawn" })[s] ?? s;

export const policyLabel = (p: string | undefined): string =>
  p === "ALL" ? "All approvers must approve" : "Any one approver can approve";

export const specialtyLabel = (s: string | null | undefined): string | null =>
  s ? ({ SecurityNetwork: "Security / Network" } as Record<string, string>)[s] ?? s : null;

/** Inbox `blockedReason` codes (backend authorizeDecision) -> short explanation for the row. */
export const blockedReasonLabel = (code: string | null): string => {
  switch (code) {
    case null:
      return "";
    case "DECIDED":
    case "ALREADY_DECIDED":
      return "Already decided";
    case "NOT_PENDING":
      return "No longer waiting for approval";
    case "NOT_CURRENT_ROUND":
      return "An earlier approval round";
    case "NOT_ELIGIBLE":
      return "You are not in the ApprovalEligible group";
    case "SELF_APPROVAL":
      return "You cannot decide on a request you own or work on";
    case "NOT_ASSIGNED":
      return "You are not an assigned approver";
    default:
      return "Not available";
  }
};

/* ---------- TASK 06: lifecycle ---------- */
/** Precise stage names (the status pill groups Readiness and Validation under "In Progress"). */
export const stageLabel = (s: ApiStatus): string =>
  ({
    DRAFT: "Draft",
    PENDING_APPROVAL: "Pending Approval",
    APPROVED: "Approved",
    REJECTED: "Rejected",
    SCHEDULED: "Scheduled",
    READINESS: "Readiness",
    IN_PROGRESS: "In Progress",
    VALIDATION: "Validation",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
  })[s] ?? s;
/** The forward path shown as a stepper. Rejected and Cancelled are exits, not steps. */
export const LIFECYCLE_STEPS: ApiStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED", "READINESS", "IN_PROGRESS", "VALIDATION", "COMPLETED"];
/** Button text for moving to a status. */
export const advanceLabel = (to: ApiStatus): string =>
  ({
    SCHEDULED: "Mark as scheduled",
    READINESS: "Start readiness",
    IN_PROGRESS: "Start maintenance",
    VALIDATION: "Start validation",
    COMPLETED: "Mark as completed",
  } as Partial<Record<ApiStatus, string>>)[to] ?? `Move to ${stageLabel(to)}`;

/* ---------- TASK 07: participation and tasks ---------- */
export const participationLabel = (p: string | null | undefined): string | null =>
  p ? ({ PENDING: "Awaiting answer", CONFIRMED: "Confirmed", DECLINED: "Declined" } as Record<string, string>)[p] ?? p : null;
export const taskStatusLabel = (s: string): string => ({ TODO: "To do", IN_PROGRESS: "In progress", DONE: "Done" } as Record<string, string>)[s] ?? s;

/* ---------- TASK 08: readiness checklist ---------- */
export const checklistGroupLabel = (g: string): string =>
  ({
    BACKUP: "Backup",
    ACCESS: "Access",
    FIREWALL_CONNECTIVITY: "Firewall and connectivity",
    TEAM_AVAILABILITY: "Team availability",
    APP_DEPENDENCIES: "Application dependencies",
    DOCUMENTATION: "Documentation",
  } as Record<string, string>)[g] ?? g;
export const itemStateLabel = (s: string): string => ({ PENDING: "Pending", DONE: "Done", NOT_APPLICABLE: "Not applicable" } as Record<string, string>)[s] ?? s;

/* ---------- TASK 09: activity log ---------- */
export const severityLabel = (s: string | null): string => (s ? s[0] + s.slice(1).toLowerCase() : "");
