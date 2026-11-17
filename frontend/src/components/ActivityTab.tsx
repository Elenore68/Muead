import { useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, MessageSquare } from "lucide-react";
import { errorMessage } from "../api/client";
import { formatDateTime, severityLabel } from "../api/labels";
import { addEntry, MAX_ENTRY_TEXT, MAX_RESOLUTION_NOTE, SEVERITIES, setIssueState, type ActivityEntry, type ActivityLog, type Severity } from "../api/activity";
import type { ApiStatus } from "../api/requests";
import { canWriteActivity, type Viewer } from "../data/permissions";
import type { ResourceState } from "../data/useResource";
import TextActionDialog from "./TextActionDialog";

interface Props {
  requestId: string;
  status: ApiStatus;
  viewer: Viewer | undefined;
  log: ResourceState<ActivityLog>;
  retry: () => void;
  onChanged: () => void;
  notify: (kind: "success" | "error", text: string) => void;
}

/** TASK 09: progress notes and issues during the maintenance. Entries are never edited; issues can be resolved and reopened. */
export default function ActivityTab({ requestId, status, viewer, log, retry, onChanged, notify }: Props) {
  const write = canWriteActivity(viewer, status);
  const [type, setType] = useState<"NOTE" | "ISSUE">("NOTE");
  const [text, setText] = useState("");
  const [severity, setSeverity] = useState<Severity>("MEDIUM");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resolving, setResolving] = useState<ActivityEntry | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return setError("Write something first.");
    setBusy(true);
    setError("");
    try {
      await addEntry(requestId, type === "ISSUE" ? { type, text: value, severity } : { type, text: value });
      setText("");
      notify("success", type === "ISSUE" ? "The issue was reported." : "The note was added.");
      onChanged();
    } catch (ex) {
      setError(errorMessage(ex));
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const reopen = async (entry: ActivityEntry) => {
    try {
      await setIssueState(requestId, entry.id, entry.version, "OPEN");
      notify("success", "The issue was reopened.");
    } catch (e) {
      notify("error", errorMessage(e));
    } finally {
      onChanged();
    }
  };

  return (
    <section className="card" style={{ marginTop: 16 }} aria-busy={log.kind === "loading"}>
      <h2 className="card-title"><MessageSquare size={20} />Activity</h2>
      {(log.kind === "loading" || log.kind === "idle") && <p className="placeholder" role="status">Loading activity…</p>}
      {log.kind === "error" && (
        <div role="alert" className="notice error">
          <span>{log.message}</span>
          <button className="btn btn-outline" onClick={retry}>Try again</button>
        </div>
      )}
      {log.kind === "ready" && (
        <>
          <p className="cell-sub" aria-label="Activity summary">
            {log.data.summary.notes} note{log.data.summary.notes === 1 ? "" : "s"} · {log.data.summary.issues} issue{log.data.summary.issues === 1 ? "" : "s"} · {log.data.summary.openIssues} open
          </p>
          {write && (
            <form onSubmit={submit} noValidate aria-busy={busy} className="activity-form">
              <div className="row3">
                <div className="field"><label htmlFor="act-type">Type</label>
                  <select id="act-type" className="select" value={type} disabled={busy} onChange={(e) => setType(e.target.value as "NOTE" | "ISSUE")}>
                    <option value="NOTE">Progress note</option>
                    <option value="ISSUE">Issue</option>
                  </select></div>
                {type === "ISSUE" && (
                  <div className="field"><label htmlFor="act-sev">Severity</label>
                    <select id="act-sev" className="select" value={severity} disabled={busy} onChange={(e) => setSeverity(e.target.value as Severity)}>
                      {SEVERITIES.map((s) => <option key={s} value={s}>{severityLabel(s)}</option>)}
                    </select></div>
                )}
              </div>
              <div className="field"><label htmlFor="act-text">{type === "ISSUE" ? "What went wrong?" : "What happened?"}</label>
                <textarea id="act-text" className="textarea" value={text} maxLength={MAX_ENTRY_TEXT} disabled={busy} onChange={(e) => setText(e.target.value)} /></div>
              {error && <p role="alert" className="notice error">{error}</p>}
              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : type === "ISSUE" ? "Report issue" : "Add note"}</button>
              </div>
            </form>
          )}
          {!write && (status === "IN_PROGRESS" || status === "VALIDATION") === false && log.data.items.length === 0 && (
            <p className="placeholder">Notes and issues appear here once the maintenance is In Progress.</p>
          )}
          {log.data.items.length > 0 && (
            <ul className="task-list" aria-label="Activity log">
              {log.data.items.map((e) => (
                <li key={e.id} className={e.state === "RESOLVED" ? "done" : ""}>
                  <div className="task-main">
                    <div className="task-meta">
                      {e.type === "ISSUE" ? (
                        <span className={`pill ${e.state === "RESOLVED" ? "st-done" : e.severity === "HIGH" ? "st-rejected" : "st-pending"}`}>
                          <AlertTriangle size={12} /> {severityLabel(e.severity)} issue · {e.state === "RESOLVED" ? "Resolved" : "Open"}
                        </span>
                      ) : (
                        <span className="pill chip">Note</span>
                      )}
                      <small>{e.author.displayName} · {formatDateTime(e.createdAt)}</small>
                    </div>
                    <div>{e.text}</div>
                    {e.state === "RESOLVED" && e.resolutionNote && (
                      <div className="cell-sub"><CheckCircle2 size={12} /> {e.resolvedBy?.displayName}: {e.resolutionNote}</div>
                    )}
                  </div>
                  {write && e.type === "ISSUE" && (
                    <div className="task-actions">
                      {e.state === "OPEN" ? (
                        <button type="button" className="btn btn-outline" onClick={() => setResolving(e)}>Resolve</button>
                      ) : (
                        <button type="button" className="btn btn-outline" onClick={() => reopen(e)}>Reopen</button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {log.data.items.length === 0 && write && <p className="placeholder">Nothing logged yet.</p>}
        </>
      )}
      {resolving && (
        <TextActionDialog
          title="Resolve issue"
          intro={resolving.text}
          label="How was it resolved?" required maxLength={MAX_RESOLUTION_NOTE} submitLabel="Resolve" busyLabel="Saving…" tone="approve"
          onClose={() => setResolving(null)}
          onSubmit={async (note) => {
            try {
              await setIssueState(requestId, resolving.id, resolving.version, "RESOLVED", note);
            } catch (e) {
              onChanged();
              throw e;
            }
            setResolving(null);
            notify("success", "The issue was resolved.");
            onChanged();
          }}
        />
      )}
    </section>
  );
}
