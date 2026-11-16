import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../api/client";

export type ResourceState<T> = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: T };

/**
 * Loads `load` when `enabled`, with stale-response protection (same pattern as useRequestList / useDashboard):
 * a response that arrives after cleanup or after a newer request is dropped.
 *  - retry():   shows the loading state again (used by "Try again").
 *  - refresh(): keeps the current data on screen and swaps it when the new copy arrives (used after actions).
 * `load` must be stable (useCallback).
 */
export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, enabled: boolean) {
  const [state, setState] = useState<ResourceState<T>>(enabled ? { kind: "loading" } : { kind: "idle" });
  const [reloadKey, setReloadKey] = useState(0);
  const silent = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const ac = new AbortController();
    if (!silent.current) setState({ kind: "loading" });
    silent.current = false;
    load(ac.signal).then(
      (data) => !ac.signal.aborted && setState({ kind: "ready", data }),
      (e) => {
        if (ac.signal.aborted || (e as Error).name === "AbortError") return;
        setState({ kind: "error", message: errorMessage(e) });
      },
    );
    return () => ac.abort();
  }, [load, enabled, reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);
  const refresh = useCallback(() => {
    silent.current = true;
    setReloadKey((k) => k + 1);
  }, []);
  return { state, retry, refresh };
}
