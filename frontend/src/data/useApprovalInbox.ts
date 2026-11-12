import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../api/client";
import { getApprovalSummary, listApprovals, type ApprovalItem, type ApprovalSummary, type InboxDecision } from "../api/approvals";
import { useResource } from "./useResource";

export const INBOX_PAGE_SIZE = 10;

/**
 * The caller's own approval records (GET /approvals) with the same cursor-pagination and
 * stale-response handling as useRequestList. Search is debounced; changing tab or search starts at page 1.
 */
export function useApprovalInbox(decision: InboxDecision, search: string) {
  const [dq, setDq] = useState(search.trim());
  useEffect(() => {
    const t = setTimeout(() => setDq(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const key = `${decision}|${dq}`;
  const [pageState, setPageState] = useState({ key, index: 0 });
  const idx = pageState.key === key ? pageState.index : 0;
  // tokens.list[i] loads page i; captured per query so a late response cannot write into another query's list.
  const tokens = useRef<{ key: string; list: (string | undefined)[] }>({ key, list: [undefined] });
  if (tokens.current.key !== key) tokens.current = { key, list: [undefined] };

  const [reloadKey, setReloadKey] = useState(0);
  const [data, setData] = useState<{ items: ApprovalItem[]; hasNext: boolean }>({ items: [], hasNext: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const ac = new AbortController();
    const pageTokens = tokens.current;
    setLoading(true);
    setError("");
    listApprovals({ decision, q: dq || undefined, limit: INBOX_PAGE_SIZE, nextToken: pageTokens.list[idx] }, ac.signal)
      .then((res) => {
        if (ac.signal.aborted) return;
        pageTokens.list[idx + 1] = res.nextToken ?? undefined;
        setData({ items: res.items, hasNext: !!res.nextToken });
        setLoading(false);
      })
      .catch((e) => {
        if (ac.signal.aborted || (e as Error).name === "AbortError") return;
        setData({ items: [], hasNext: false });
        setError(errorMessage(e));
        setLoading(false);
      });
    return () => ac.abort();
  }, [key, idx, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadSummary = useCallback((signal: AbortSignal) => getApprovalSummary(signal), []);
  const summary = useResource<ApprovalSummary>(loadSummary, true);

  return {
    items: data.items,
    loading,
    error,
    page: idx,
    hasNext: data.hasNext,
    searching: !!dq,
    summary: summary.state,
    next: useCallback(() => data.hasNext && setPageState({ key, index: idx + 1 }), [data.hasNext, key, idx]),
    prev: useCallback(() => idx > 0 && setPageState({ key, index: idx - 1 }), [key, idx]),
    /** Re-fetch the current page and the counts (after a decision). */
    reload: useCallback(() => {
      setReloadKey((k) => k + 1);
      summary.refresh();
    }, [summary.refresh]), // eslint-disable-line react-hooks/exhaustive-deps
  };
}
