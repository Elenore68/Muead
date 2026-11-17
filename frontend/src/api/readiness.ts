import { api } from "./client";

/* TASK 08: readiness checklist (docs/backend/api-specification.md section 16). */
export type ChecklistGroup = "BACKUP" | "ACCESS" | "FIREWALL_CONNECTIVITY" | "TEAM_AVAILABILITY" | "APP_DEPENDENCIES" | "DOCUMENTATION";
export type ItemState = "PENDING" | "DONE" | "NOT_APPLICABLE";

export interface ChecklistItem {
  id: string;
  group: ChecklistGroup;
  title: string;
  custom: boolean;
  state: ItemState;
  note: string | null;
  updatedBy: { id: string; displayName: string } | null;
  updatedAt: string;
  version: number;
}

export interface ReadinessProgress {
  total: number;
  resolved: number;
  done: number;
  percent: number;
}

export interface Readiness {
  items: ChecklistItem[];
  progress: ReadinessProgress;
  requestStatus: string;
  /** false until the request enters the Readiness stage. */
  started: boolean;
}

export const CHECKLIST_GROUPS: ChecklistGroup[] = ["BACKUP", "ACCESS", "FIREWALL_CONNECTIVITY", "TEAM_AVAILABILITY", "APP_DEPENDENCIES", "DOCUMENTATION"];
export const MAX_ITEM_TITLE = 200;
export const MAX_ITEM_NOTE = 500;

const enc = encodeURIComponent;
export const getReadiness = (requestId: string, signal?: AbortSignal) => api<Readiness>(`requests/${enc(requestId)}/readiness`, { signal });
export const updateItem = (requestId: string, itemId: string, version: number, state: ItemState, note?: string) =>
  api<ChecklistItem>(`requests/${enc(requestId)}/readiness/${enc(itemId)}`, { method: "PATCH", body: { version, state, ...(note ? { note } : {}) } });
export const addItem = (requestId: string, group: ChecklistGroup, title: string) =>
  api<ChecklistItem>(`requests/${enc(requestId)}/readiness`, { method: "POST", body: { group, title } });
export const deleteItem = (requestId: string, itemId: string) => api<void>(`requests/${enc(requestId)}/readiness/${enc(itemId)}`, { method: "DELETE" });
