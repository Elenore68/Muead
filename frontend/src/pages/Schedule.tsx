import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { Topbar } from "../components/Layout";
import { StatusPill } from "../components/ui";
import { config } from "../config";
import { formatDateTime, statusLabel } from "../api/labels";
import { getSchedule } from "../api/schedule";
import { useResource } from "../data/useResource";

const pad = (n: number) => String(n).padStart(2, "0");
/** First and last day (yyyy-mm-dd) of a month, in UTC. */
export const monthRange = (year: number, month0: number) => ({
  from: `${year}-${pad(month0 + 1)}-01`,
  to: `${year}-${pad(month0 + 1)}-${pad(new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate())}`,
});
const dayKey = (iso: string) => iso.slice(0, 10);
const dayLabel = (key: string) => new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });

/** TASK 12: planned and running maintenance of the signed-in person (all of it for platform admins), by day, with conflict warnings. */
export default function Schedule() {
  const now = new Date();
  const [cursor, setCursor] = useState({ year: now.getUTCFullYear(), month: now.getUTCMonth() });
  const range = useMemo(() => monthRange(cursor.year, cursor.month), [cursor]);
  const load = useCallback((signal: AbortSignal) => getSchedule(range, signal), [range]);
  const { state, retry } = useResource(load, config.apiEnabled);
  const title = new Date(Date.UTC(cursor.year, cursor.month, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const shift = (by: number) => setCursor((c) => {
    const d = new Date(Date.UTC(c.year, c.month + by, 1));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
  });

  const days = useMemo(() => {
    if (state.kind !== "ready") return [];
    const map = new Map<string, typeof state.data.items>();
    for (const i of state.data.items) map.set(dayKey(i.start), [...(map.get(dayKey(i.start)) ?? []), i]);
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [state]);

  return (
    <>
      <Topbar title="Schedule" subtitle="Planned and running maintenance activities." />
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="member-main">
          <button type="button" className="btn-icon" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft size={18} /></button>
          <h2 className="card-title" style={{ margin: 0 }} aria-live="polite">{title}</h2>
          <button type="button" className="btn-icon" aria-label="Next month" onClick={() => shift(1)}><ChevronRight size={18} /></button>
        </div>
      </div>
      {(state.kind === "loading" || state.kind === "idle") && <div className="card placeholder" role="status">Loading schedule…</div>}
      {state.kind === "error" && (
        <div role="alert" className="notice error">
          <span>{state.message}</span>
          <button className="btn btn-outline" onClick={retry}>Try again</button>
        </div>
      )}
      {state.kind === "ready" && (
        <>
          {state.data.conflicts > 0 && (
            <div role="status" className="notice warning">
              <span><AlertTriangle size={16} /> {state.data.conflicts} {state.data.conflicts === 1 ? "activity has" : "activities have"} a conflict this month. Open it to see why.</span>
            </div>
          )}
          {state.data.truncated && <div role="status" className="notice warning"><span>Only the first activities are shown. Choose a shorter period.</span></div>}
          {days.length === 0 && <div className="card placeholder">No planned maintenance in {title}.</div>}
          {days.map(([key, items]) => (
            <section key={key} className="card" style={{ marginBottom: 12 }} aria-label={dayLabel(key)}>
              <h3>{dayLabel(key)}</h3>
              <ul className="task-list">
                {items.map((i) => (
                  <li key={i.requestId}>
                    <div className="task-main">
                      <Link to={`/requests/${i.requestId}`} className="link"><strong>{i.requestNo} – {i.title}</strong></Link>
                      <span className="cell-sub">
                        {formatDateTime(i.start)}{i.end ? ` – ${formatDateTime(i.end)}` : ""}{i.environment ? ` · ${i.environment}` : ""} · {i.owner.displayName}
                      </span>
                    </div>
                    <div className="task-actions">
                      {i.conflictCount > 0 && (
                        <span className="pill st-rejected" title="Overlaps another activity that shares a system or a person">
                          <AlertTriangle size={12} /> {i.conflictCount} conflict{i.conflictCount === 1 ? "" : "s"}
                        </span>
                      )}
                      <StatusPill status={statusLabel(i.status)} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </>
  );
}
