import { useCallback, useEffect, useState } from "react";
import { config } from "../config";
import { ApiClientError, errorMessage } from "../api/client";
import { getRequest, listAttachments, type Attachment, type RequestDetail } from "../api/requests";
import { formatDate, priorityLabel, statusLabel } from "../api/labels";
import { requests as mockRequests } from "./mock";

/** What the Request Details page renders, independent of the data source. */
export interface RequestView {
  /** Request number shown in the header and breadcrumb (e.g. REQ-0142). */
  displayId: string;
  title: string;
  description: string;
  category: string | null;
  priority: string | null;
  status: string;
  owner: { id?: string; name: string; initials?: string };
  targetDate: string | null;
  createdOn: string;
  /** SOW fields that the API may return. Shown only when present. */
  extra: { label: string; value: string }[];
  links: { label: string; url: string }[];
}

export type LoadState<T> =
  | { kind: "loading" }
  | { kind: "notFound" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: T };

const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/** Only http(s) links are rendered as anchors (the backend validates too). */
const safeLinks = (links: RequestDetail["links"]) =>
  (links ?? []).filter((l) => {
    try {
      return ["http:", "https:"].includes(new URL(l.url).protocol);
    } catch {
      return false;
    }
  });

const fromApi = (r: RequestDetail): RequestView => {
  const extra: RequestView["extra"] = [];
  const add = (label: string, v: string | undefined | null) => v && extra.push({ label, value: v });
  add("Environment", r.environment);
  add("Cloud Platform", r.cloudPlatform);
  add("Maintenance Type", r.maintenanceType);
  add("Affected Systems", r.affectedSystems?.length ? r.affectedSystems.join(", ") : undefined);
  add("Scope", r.scope);
  add("Schedule End", r.schedule?.end ? formatDateTime(r.schedule.end) : undefined);
  return {
    displayId: r.requestNo,
    title: r.title,
    description: r.description,
    category: r.category,
    priority: priorityLabel(r.priority),
    status: statusLabel(r.status),
    owner: { id: r.owner.id, name: r.owner.displayName, initials: r.owner.initials },
    targetDate: r.schedule?.start ? formatDate(r.schedule.start) : null,
    createdOn: formatDateTime(r.createdAt),
    extra,
    links: safeLinks(r.links),
  };
};

/* ------------------------------------------------------------------ details */
function useLiveRequestDetails(id: string) {
  const [state, setState] = useState<LoadState<RequestView>>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    setState({ kind: "loading" });
    // `ac.signal.aborted` also covers a response that finished just before cleanup (stale retry).
    getRequest(id, ac.signal).then(
      (r) => !ac.signal.aborted && setState({ kind: "ready", data: fromApi(r) }),
      (e) => {
        if (ac.signal.aborted || (e as Error).name === "AbortError") return;
        // The API answers 404 both for unknown ids and for requests the user may not see.
        if (e instanceof ApiClientError && e.status === 404) setState({ kind: "notFound" });
        else setState({ kind: "error", message: errorMessage(e) });
      },
    );
    return () => ac.abort();
  }, [id, reloadKey]);

  return { state, retry: useCallback(() => setReloadKey((k) => k + 1), []) };
}

function useMockRequestDetails(id: string) {
  const r = mockRequests.find((x) => x.id === id);
  const state: LoadState<RequestView> = r
    ? {
        kind: "ready",
        data: {
          displayId: r.id, title: r.title, description: r.description, category: r.category, priority: r.priority,
          status: r.status, owner: { name: r.requestedBy }, targetDate: r.targetDate, createdOn: r.created, extra: [], links: [],
        },
      }
    : { kind: "notFound" };
  return { state, retry: () => {} };
}

export const useRequestDetails = config.apiEnabled ? useLiveRequestDetails : useMockRequestDetails;

/* ------------------------------------------------------------------ attachments (live only) */
/** Loads attachments the first time `active` becomes true, then keeps the result. */
export function useAttachments(requestId: string, active: boolean) {
  const [state, setState] = useState<LoadState<Attachment[]> | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [wanted, setWanted] = useState(false);
  if (active && !wanted) setWanted(true);

  useEffect(() => {
    if (!config.apiEnabled || !wanted) return;
    const ac = new AbortController();
    setState({ kind: "loading" });
    listAttachments(requestId, ac.signal).then(
      (r) => !ac.signal.aborted && setState({ kind: "ready", data: r.items }),
      (e) => {
        if (ac.signal.aborted || (e as Error).name === "AbortError") return;
        setState({ kind: "error", message: errorMessage(e) });
      },
    );
    return () => ac.abort();
  }, [requestId, wanted, reloadKey]);

  return { state, retry: useCallback(() => setReloadKey((k) => k + 1), []) };
}
