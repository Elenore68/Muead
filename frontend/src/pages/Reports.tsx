import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { Download } from "lucide-react";
import { Topbar } from "../components/Layout";
import { StatusPill } from "../components/ui";
import { config } from "../config";
import { formatDate, statusLabel } from "../api/labels";
import { listRequests, type Page, type RequestSummary } from "../api/requests";
import { downloadCsv, toCsv } from "../data/csv";
import { useResource } from "../data/useResource";

type Filter = "COMPLETED" | "CANCELLED";
const PAGE = 20;

/** TASK 13: finished maintenance (completed or cancelled) with a link to each final report, and a CSV export of the list. */
export default function Reports() {
  const [filter, setFilter] = useState<Filter>("COMPLETED");
  const [q, setQ] = useState("");
  const [token, setToken] = useState<string | undefined>();
  const [history, setHistory] = useState<(string | undefined)[]>([]);
  const load = useCallback(
    (signal: AbortSignal): Promise<Page<RequestSummary>> => listRequests({ status: filter, q: q.trim() || undefined, limit: PAGE, nextToken: token }, signal),
    [filter, q, token],
  );
  const { state, retry } = useResource(load, config.apiEnabled);

  const reset = () => {
    setToken(undefined);
    setHistory([]);
  };
  const exportCsv = () => {
    if (state.kind !== "ready") return;
    downloadCsv(
      `maintenance-${filter.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(
        ["Request", "Title", "Status", "Owner", "Category", "Priority", "Schedule start", "Created", "Last update"],
        state.data.items.map((r) => [r.requestNo, r.title, statusLabel(r.status), r.owner.displayName, r.category, r.priority, r.schedule?.start ?? "", r.createdAt, r.updatedAt]),
      ),
    );
  };

  return (
    <>
      <Topbar title="Reports" subtitle="Finished maintenance and final reports." />
      <section className="card" aria-label="Finished maintenance">
        <div className="row3">
          <div className="field">
            <label htmlFor="rep-filter">Show</label>
            <select id="rep-filter" className="select" value={filter} onChange={(e) => { setFilter(e.target.value as Filter); reset(); }}>
              <option value="COMPLETED">Completed (with final report)</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="rep-q">Search</label>
            <input id="rep-q" className="input" value={q} placeholder="Title or request number" onChange={(e) => { setQ(e.target.value); reset(); }} />
          </div>
        </div>
        {(state.kind === "loading" || state.kind === "idle") && <p className="placeholder" role="status">Loading…</p>}
        {state.kind === "error" && (
          <div role="alert" className="notice error">
            <span>{state.message}</span>
            <button className="btn btn-outline" onClick={retry}>Try again</button>
          </div>
        )}
        {state.kind === "ready" && state.data.items.length === 0 && <p className="placeholder">Nothing here yet.</p>}
        {state.kind === "ready" && state.data.items.length > 0 && (
          <>
            <table className="table" aria-label="Finished requests">
              <thead><tr><th>Request</th><th>Title</th><th>Owner</th><th>Status</th><th>Last update</th><th /></tr></thead>
              <tbody>
                {state.data.items.map((r) => (
                  <tr key={r.id}>
                    <td>{r.requestNo}</td>
                    <td>{r.title}</td>
                    <td>{r.owner.displayName}</td>
                    <td><StatusPill status={statusLabel(r.status)} /></td>
                    <td>{formatDate(r.updatedAt)}</td>
                    <td>
                      <Link className="link" to={`/requests/${r.id}`} state={{ tab: filter === "COMPLETED" ? "Report" : "Details" }}>
                        {filter === "COMPLETED" ? "Open report" : "Open"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="card-actions">
              <button type="button" className="btn btn-outline" onClick={exportCsv}><Download size={16} />Download CSV</button>
              <button type="button" className="btn btn-outline" disabled={history.length === 0} onClick={() => { setToken(history[history.length - 1]); setHistory((h) => h.slice(0, -1)); }}>Previous</button>
              <button type="button" className="btn btn-outline" disabled={!state.data.nextToken} onClick={() => { setHistory((h) => [...h, token]); setToken(state.data.nextToken ?? undefined); }}>Next</button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
