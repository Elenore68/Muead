import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { config } from "../config";
import { errorMessage } from "../api/client";
import { getCounts, listRequests, type Counts } from "../api/requests";
import { formatDate, priorityLabel, statusLabel } from "../api/labels";
import { requests as mockRequests } from "./mock";

/** One table row, independent of where the data came from. */
export interface RequestRow {
  key: string;
  /** Id used in the route /requests/:id */
  linkId: string;
  displayId: string;
  title: string;
  category: string | null;
  requestedBy: string;
  requestedByInitials?: string;
  assignedTo: string | null;
  priority: string | null;
  status: string;
  created: string;
}

export const TABS = ["All", "Pending", "In Progress", "Completed", "Rejected"] as const;
export type Tab = (typeof TABS)[number];
export const PAGE_SIZE = 10;

export interface RequestList {
  rows: RequestRow[];
  loading: boolean;
  error: string;
  /** Count per tab, or null when unavailable. */
  tabCounts: Partial<Record<Tab, number>> | null;
  /** 0-based page. */
  page: number;
  hasNext: boolean;
  /** Total for the current tab when it is known (not known while searching). */
  total: number | null;
  next: () => void;
  prev: () => void;
  reload: () => void;
}

/* ------------------------------------------------------------------ live (backend) */
const TAB_STATUS: Record<Tab, string | undefined> = {
  All: undefined,
  Pending: "PENDING_APPROVAL",
  "In Progress": "IN_PROGRESS,READINESS,VALIDATION",
  Completed: "COMPLETED",
  Rejected: "REJECTED",
};

const tabCountsFrom = (c: Counts): Partial<Record<Tab, number>> => {
  const n = (...s: (keyof Counts["byStatus"])[]) => s.reduce((a, k) => a + (c.byStatus[k] ?? 0), 0);
  return { All: c.all, Pending: n("PENDING_APPROVAL"), "In Progress": n("IN_PROGRESS", "READINESS", "VALIDATION"), Completed: n("COMPLETED"), Rejected: n("REJECTED") };
};

function useLiveRequestList(tab: Tab, search: string): RequestList {
  const [dq, setDq] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setDq(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const key = `${tab}|${dq}`;
  const [pageState, setPageState] = useState({ key, index: 0 });
  const idx = pageState.key === key ? pageState.index : 0;
  // Page tokens for cursor pagination: list[i] is the token that loads page i.
  const tokens = useRef<{ key: string; list: (string | undefined)[] }>({ key, list: [undefined] });
  if (tokens.current.key !== key) tokens.current = { key, list: [undefined] };

  const [reloadKey, setReloadKey] = useState(0);
  const [data, setData] = useState<{ rows: RequestRow[]; hasNext: boolean }>({ rows: [], hasNext: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [counts, setCounts] = useState<Counts | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    // Capture this query's token list. tokens.current is replaced during render when tab/search change,
    // so a late response must never write its nextToken into another query's list.
    const pageTokens = tokens.current;
    setLoading(true);
    setError("");
    listRequests({ status: TAB_STATUS[tab], q: dq || undefined, limit: PAGE_SIZE, nextToken: pageTokens.list[idx] }, ac.signal)
      .then((res) => {
        // Cleanup already ran (newer tab/search/page/reload): drop this response.
        // Checked explicitly because a response can finish just before abort() is called.
        if (ac.signal.aborted) return;
        pageTokens.list[idx + 1] = res.nextToken ?? undefined;
        setData({
          hasNext: !!res.nextToken,
          rows: res.items.map((r) => ({
            key: r.id,
            linkId: r.id,
            displayId: r.requestNo,
            title: r.title,
            category: r.category,
            requestedBy: r.owner.displayName,
            requestedByInitials: r.owner.initials,
            // The API has no per-request assignee (assignments are per task in the SOW). Open question documented.
            assignedTo: null,
            priority: priorityLabel(r.priority),
            status: statusLabel(r.status),
            created: formatDate(r.createdAt),
          })),
        });
        setLoading(false);
      })
      .catch((e) => {
        if (ac.signal.aborted || (e as Error).name === "AbortError") return;
        setData({ rows: [], hasNext: false });
        setError(errorMessage(e));
        setLoading(false);
      });
    return () => ac.abort();
  }, [key, idx, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const ac = new AbortController();
    // Counts are decoration; on failure the tabs show plain labels and the list still works.
    // Ignore results after cleanup so an older (or aborted) call cannot overwrite newer counts.
    getCounts(ac.signal).then(
      (c) => !ac.signal.aborted && setCounts(c),
      () => !ac.signal.aborted && setCounts(null),
    );
    return () => ac.abort();
  }, [reloadKey]);

  const tabCounts = useMemo(() => (counts ? tabCountsFrom(counts) : null), [counts]);
  return {
    rows: data.rows,
    loading,
    error,
    tabCounts,
    page: idx,
    hasNext: data.hasNext,
    total: !dq && tabCounts ? (tabCounts[tab] ?? null) : null,
    next: useCallback(() => data.hasNext && setPageState({ key, index: idx + 1 }), [data.hasNext, key, idx]),
    prev: useCallback(() => idx > 0 && setPageState({ key, index: idx - 1 }), [key, idx]),
    reload: useCallback(() => setReloadKey((k) => k + 1), []),
  };
}

/* ------------------------------------------------------------------ mock (original behaviour) */
function useMockRequestList(tab: Tab, search: string): RequestList {
  const all = useMemo<RequestRow[]>(
    () =>
      mockRequests.map((r) => ({
        key: r.id, linkId: r.id, displayId: r.id, title: r.title, category: r.category, requestedBy: r.requestedBy,
        assignedTo: r.assignedTo, priority: r.priority, status: r.status, created: r.created,
      })),
    [],
  );
  const rows = useMemo(
    () => all.filter((r) => (tab === "All" || r.status === tab) && `${r.displayId} ${r.title}`.toLowerCase().includes(search.toLowerCase())),
    [all, tab, search],
  );
  const tabCounts = useMemo(() => {
    const c: Partial<Record<Tab, number>> = { All: all.length };
    for (const t of TABS.slice(1)) c[t] = all.filter((r) => r.status === t).length;
    return c;
  }, [all]);
  return { rows, loading: false, error: "", tabCounts, page: 0, hasNext: false, total: rows.length, next: () => {}, prev: () => {}, reload: () => {} };
}

export const useRequestList = config.apiEnabled ? useLiveRequestList : useMockRequestList;
