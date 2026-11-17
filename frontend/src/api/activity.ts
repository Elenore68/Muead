import { api } from "./client";

/* TASK 09: activity log of a request (docs/backend/api-specification.md section 17). */
export type EntryType = "NOTE" | "ISSUE";
export type Severity = "LOW" | "MEDIUM" | "HIGH";
export type IssueState = "OPEN" | "RESOLVED";

export interface ActivityEntry {
  id: string;
  type: EntryType;
  text: string;
  severity: Severity | null;
  state: IssueState | null;
  resolutionNote: string | null;
  resolvedBy: { id: string; displayName: string } | null;
  resolvedAt: string | null;
  author: { id: string; displayName: string; activityRole: string };
  createdAt: string;
  version: number;
}

export interface ActivityLog {
  items: ActivityEntry[];
  summary: { notes: number; issues: number; openIssues: number; openHigh: number };
  requestStatus: string;
}

export const MAX_ENTRY_TEXT = 2000;
export const MAX_RESOLUTION_NOTE = 1000;
export const SEVERITIES: Severity[] = ["LOW", "MEDIUM", "HIGH"];

const enc = encodeURIComponent;
export const getActivity = (requestId: string, signal?: AbortSignal) => api<ActivityLog>(`requests/${enc(requestId)}/activity`, { signal });
export const addEntry = (requestId: string, input: { type: "NOTE"; text: string } | { type: "ISSUE"; text: string; severity: Severity }) =>
  api<ActivityEntry>(`requests/${enc(requestId)}/activity`, { method: "POST", body: input });
export const setIssueState = (requestId: string, entryId: string, version: number, state: IssueState, note?: string) =>
  api<ActivityEntry>(`requests/${enc(requestId)}/activity/${enc(entryId)}`, { method: "PATCH", body: { version, state, ...(note ? { note } : {}) } });
