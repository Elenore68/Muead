import { api } from "./client";

/*
 * Dashboard endpoints (backend/src/handlers/dashboard.ts).
 * scope: "all" = global aggregates (backend allows it for PlatformAdmin and Approver; the UI only sends it for
 * PlatformAdmin). "mine" (default) = the caller's own requests. /dashboard/upcoming has no scope parameter:
 * the backend already returns all items to platform admins and only own items to everyone else.
 */
export type DashboardScope = "mine" | "all";

export interface SummaryResponse {
  scope: DashboardScope;
  totals: { total: number; pendingApprovals: number; inProgress: number; completed: number };
  byStatus: { status: string; count: number }[];
  byCategory: { category: string; count: number }[];
}

export interface OverTimeResponse {
  /** One entry per day (UTC), zero-filled, oldest first. */
  points: { date: string; count: number }[];
}

export interface UpcomingResponse {
  items: { requestId: string; requestNo: string; title: string; start: string; end: string | null; status: string }[];
}

export const getSummary = (scope: DashboardScope, signal?: AbortSignal) =>
  api<SummaryResponse>("dashboard/summary", { query: { scope }, signal });

/** from/to are YYYY-MM-DD (UTC days, inclusive). */
export const getRequestsOverTime = (scope: DashboardScope, from: string, to: string, signal?: AbortSignal) =>
  api<OverTimeResponse>("dashboard/requests-over-time", { query: { scope, from, to, interval: "day" }, signal });

export const getUpcoming = (days: number, limit: number, signal?: AbortSignal) =>
  api<UpcomingResponse>("dashboard/upcoming", { query: { days, limit }, signal });
