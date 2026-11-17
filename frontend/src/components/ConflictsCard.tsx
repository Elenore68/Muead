import { AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { formatDateTime } from "../api/labels";
import type { ConflictsResponse } from "../api/schedule";
import type { ResourceState } from "../data/useResource";

/** TASK 12: warnings about other planned activities that overlap in time and share a system or a person. Never blocks anything. */
export default function ConflictsCard({ state, retry }: { state: ResourceState<ConflictsResponse>; retry: () => void }) {
  if (state.kind === "idle") return null;
  return (
    <div className="card" aria-label="Schedule conflicts">
      <h3><AlertTriangle size={16} /> Schedule conflicts</h3>
      {state.kind === "loading" && <p className="cell-sub" role="status">Checking…</p>}
      {state.kind === "error" && (
        <div role="alert" className="notice error">
          <span>{state.message}</span>
          <button className="btn btn-outline" onClick={retry}>Try again</button>
        </div>
      )}
      {state.kind === "ready" && !state.data.scheduled && <p className="cell-sub">Set a start date to check for conflicts.</p>}
      {state.kind === "ready" && state.data.scheduled && state.data.items.length === 0 && <p className="cell-sub">No conflicts with other planned maintenance.</p>}
      {state.kind === "ready" && state.data.items.length > 0 && (
        <ul className="member-list" aria-label="Conflicts">
          {state.data.items.map((c, i) => (
            <li key={`${c.requestId ?? "restricted"}-${i}`}>
              <strong>
                {c.restricted || !c.requestId ? "Another maintenance" : <Link to={`/requests/${c.requestId}`} className="link">{c.requestNo} – {c.title}</Link>}
              </strong>
              <span className="cell-sub">{formatDateTime(c.start)}{c.end ? ` – ${formatDateTime(c.end)}` : ""}</span>
              {c.reasons.map((r) => (
                <span key={r.type} className="cell-sub">
                  {r.type === "SYSTEM"
                    ? `Same environment and ${c.restricted ? "an affected system in common" : `system: ${r.systems?.join(", ")}`}`
                    : c.restricted
                      ? `${r.peopleCount ?? 1} ${r.peopleCount === 1 ? "person works" : "people work"} on both`
                      : `Shared people: ${r.people?.map((p) => p.displayName).join(", ")}`}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
