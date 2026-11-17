import { api } from "./client";

/* TASK 10: validation results and the final report (docs/backend/api-specification.md section 18). */
export type Domain = "APPLICATION" | "DATABASE" | "OS" | "INFRASTRUCTURE";
export type Result = "PENDING" | "PASSED" | "FAILED" | "NOT_APPLICABLE";

export interface ValidationItem {
  domain: Domain;
  title: string;
  result: Result;
  note: string | null;
  updatedBy: { id: string; displayName: string } | null;
  updatedAt: string;
  version: number;
}

export interface ValidationState {
  items: ValidationItem[];
  progress: { total: number; resolved: number; passed: number; failed: number; percent: number };
  requestStatus: string;
  started: boolean;
}

export const DOMAINS: Domain[] = ["APPLICATION", "DATABASE", "OS", "INFRASTRUCTURE"];
export const MAX_NOTE = 1000;
export const MAX_SUMMARY = 5000;
export const MAX_REMAINING = 2000;

/** The report is a snapshot written when the request is closed. */
export interface FinalReport {
  requestId: string;
  generatedAt: string;
  completedByName: string;
  summary: string;
  remainingIssues?: string;
  request: {
    requestNo: string; title: string; description: string; category: string | null; priority: string | null; environment: string | null;
    cloudPlatform: string | null; maintenanceType: string | null; scope: string | null; affectedSystems: string[];
    schedule: { start: string; end: string | null } | null;
  };
  people: {
    owner: { id: string; displayName: string };
    participants: { id: string; displayName: string; specialty: string | null; participation: string | null }[];
    approvers: { id: string; displayName: string }[];
  };
  approval: { policy: string; rounds: number; decidedAt: string | null };
  timeline: Record<string, string | null>;
  tasks: { total: number; done: number; percent: number; items: { title: string; assignee: string; status: string; dueDate: string | null }[] };
  readiness: { total: number; resolved: number; percent: number; items: { group: string; title: string; state: string; note: string | null }[] };
  validation: { total: number; passed: number; failed: number; items: { domain: string; result: string; note: string | null }[] };
  activity: { notes: number; issues: { text: string; severity: string | null; state: string | null; resolutionNote: string | null }[]; openIssues: number };
}

const enc = encodeURIComponent;
export const getValidation = (requestId: string, signal?: AbortSignal) => api<ValidationState>(`requests/${enc(requestId)}/validation`, { signal });
export const setResult = (requestId: string, domain: Domain, version: number, result: Result, note?: string) =>
  api<ValidationItem>(`requests/${enc(requestId)}/validation/${enc(domain)}`, { method: "PATCH", body: { version, result, ...(note ? { note } : {}) } });
export const getReport = (requestId: string, signal?: AbortSignal) => api<FinalReport>(`requests/${enc(requestId)}/report`, { signal });
