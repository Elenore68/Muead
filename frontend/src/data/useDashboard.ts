import { useCallback, useEffect, useState } from "react";
import { config } from "../config";
import { errorMessage } from "../api/client";
import { getRequestsOverTime, getSummary, getUpcoming, type DashboardScope } from "../api/dashboard";
import { useAuth } from "../auth/AuthContext";
import { byCategory as mockByCategory, overTime as mockOverTime, overTimeLabels as mockOverTimeLabels, schedule as mockSchedule } from "./mock";

/* ------------------------------------------------------------------ view model (source-independent) */
export type SectionState<T> = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: T };
export interface Section<T> {
  state: SectionState<T>;
  retry: () => void;
}

export interface SummaryView {
  totals: { total: number; pendingApprovals: number; inProgress: number; completed: number };
  categories: { name: string; n: number; color: string }[];
}
/** label === null: point is drawn but has no axis label. */
export interface ChartPoint {
  value: number;
  label: string | null;
}
export interface UpcomingItem {
  key: string;
  title: string;
  when: string;
  color: string;
}

export interface DashboardData {
  firstName: string;
  summary: Section<SummaryView>;
  overTime: Section<ChartPoint[]>;
  upcoming: Section<UpcomingItem[]>;
}

// Colours already used by the design (category bars and schedule markers), cycled by position.
const CATEGORY_COLORS = ["var(--c-primary)", "var(--c-pink)", "var(--c-amber)", "#d9bff7"];
const SCHEDULE_COLORS = ["var(--c-primary)", "var(--c-pink)", "var(--c-amber)"];

const CHART_DAYS = 17; // decision 3: last 17 days
const UPCOMING_DAYS = 14; // backend default window
const UPCOMING_LIMIT = 3; // the designed card shows three items

/* ------------------------------------------------------------------ helpers */
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/** "Oct 25" for a YYYY-MM-DD day. Formatted in UTC because the backend buckets days in UTC. */
const dayLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** "Nov 12, 2026 · 10:00 AM" in the user's local time, as in the design. */
const scheduleWhen = (iso: string) => {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
};

/**
 * Runs `load` on mount and on retry. `load` must be stable (useCallback).
 * Late responses are dropped after cleanup, including ones that finished just before abort().
 */
function useSection<T>(load: (signal: AbortSignal) => Promise<T>): Section<T> {
  const [state, setState] = useState<SectionState<T>>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    setState({ kind: "loading" });
    load(ac.signal).then(
      (data) => !ac.signal.aborted && setState({ kind: "ready", data }),
      (e) => {
        if (ac.signal.aborted || (e as Error).name === "AbortError") return;
        setState({ kind: "error", message: errorMessage(e) });
      },
    );
    return () => ac.abort();
  }, [load, reloadKey]);

  return { state, retry: useCallback(() => setReloadKey((k) => k + 1), []) };
}

const firstNameOf = (displayName: string | undefined) => (displayName ?? "").trim().split(/\s+/)[0] ?? "";

/* ------------------------------------------------------------------ live */
function useLiveDashboard(): DashboardData {
  const { profile } = useAuth();
  // Decision 2: platform admins see global data; everyone else sees their own requests.
  const scope: DashboardScope = profile?.roles.includes("PlatformAdmin") ? "all" : "mine";

  const loadSummary = useCallback(
    async (signal: AbortSignal): Promise<SummaryView> => {
      const r = await getSummary(scope, signal);
      return {
        totals: r.totals,
        categories: r.byCategory.map((c, i) => ({ name: c.category, n: c.count, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] })),
      };
    },
    [scope],
  );

  const loadOverTime = useCallback(
    async (signal: AbortSignal): Promise<ChartPoint[]> => {
      const now = Date.now();
      const to = utcDay(now);
      const from = utcDay(now - (CHART_DAYS - 1) * 86_400_000);
      const r = await getRequestsOverTime(scope, from, to, signal);
      // Decision 3: a label on every second day, starting with the first.
      return r.points.map((p, i) => ({ value: p.count, label: i % 2 === 0 ? dayLabel(p.date) : null }));
    },
    [scope],
  );

  const loadUpcoming = useCallback(async (signal: AbortSignal): Promise<UpcomingItem[]> => {
    const r = await getUpcoming(UPCOMING_DAYS, UPCOMING_LIMIT, signal);
    return r.items.map((it, i) => ({ key: it.requestId, title: it.title, when: scheduleWhen(it.start), color: SCHEDULE_COLORS[i % SCHEDULE_COLORS.length] }));
  }, []);

  return {
    firstName: firstNameOf(profile?.displayName),
    summary: useSection(loadSummary),
    overTime: useSection(loadOverTime),
    upcoming: useSection(loadUpcoming),
  };
}

/* ------------------------------------------------------------------ mock (original hard-coded values) */
const noop = () => {};
const MOCK: DashboardData = {
  firstName: "Amal",
  summary: {
    state: {
      kind: "ready",
      data: {
        totals: { total: 12, pendingApprovals: 4, inProgress: 5, completed: 3 },
        categories: mockByCategory.map((c) => ({ name: c.name, n: c.n, color: c.color })),
      },
    },
    retry: noop,
  },
  overTime: { state: { kind: "ready", data: mockOverTime.map((v, i) => ({ value: v, label: mockOverTimeLabels[i] })) }, retry: noop },
  upcoming: { state: { kind: "ready", data: mockSchedule.map((s) => ({ key: s.title, title: s.title, when: s.when, color: s.color })) }, retry: noop },
};
const useMockDashboard = (): DashboardData => MOCK;

// Chosen once at startup, so the hook order never changes between renders.
export const useDashboard = config.apiEnabled ? useLiveDashboard : useMockDashboard;
