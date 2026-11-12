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
