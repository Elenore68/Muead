import { api } from "./client";
import type { ApiStatus } from "./requests";

/* TASK 12: schedule and conflict warnings (docs/backend/api-specification.md section 20). */
export interface ScheduleItem {
  requestId: string;
  requestNo: string;
  title: string;
  status: ApiStatus;
  start: string;
  end: string | null;
  environment: string | null;
  owner: { id: string; displayName: string; initials: string };
  /** How many other planned activities overlap this one and share a system or a person. */
  conflictCount: number;
}

export interface ScheduleResponse {
  from: string;
  to: string;
  items: ScheduleItem[];
  conflicts: number;
  truncated: boolean;
}

export interface ConflictReason {
  type: "SYSTEM" | "PEOPLE";
  /** Only for activities the caller belongs to. */
  systems?: string[];
  people?: { id: string; displayName: string }[];
  peopleCount?: number;
}

export interface Conflict {
  /** true when the caller is not part of the other activity: number, title and details are hidden. */
  restricted: boolean;
  requestId: string | null;
  requestNo: string | null;
  title: string | null;
  status: ApiStatus;
  start: string;
  end: string | null;
  environment: string | null;
  reasons: ConflictReason[];
}

export interface ConflictsResponse {
  scheduled: boolean;
  items: Conflict[];
}

export const getSchedule = (p: { from: string; to: string }, signal?: AbortSignal) => api<ScheduleResponse>("schedule", { query: p, signal });
export const getConflicts = (requestId: string, signal?: AbortSignal) => api<ConflictsResponse>(`requests/${encodeURIComponent(requestId)}/conflicts`, { signal });
