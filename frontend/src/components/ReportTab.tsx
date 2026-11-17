import { useState } from "react";
import { FileText, Sparkles } from "lucide-react";
import { ApiClientError, errorMessage } from "../api/client";
import { domainLabel, formatDateTime, resultLabel, taskStatusLabel } from "../api/labels";
import { generateSummary, MAX_SUMMARY_TEXT, saveSummary, type FinalReport, type SummaryLanguage } from "../api/validation";
import type { ApiStatus } from "../api/requests";
import type { ResourceState } from "../data/useResource";
import type { Viewer } from "../data/permissions";

interface Props {
  requestId?: string;
  status: ApiStatus;
  report: ResourceState<FinalReport>;
  retry: () => void;
  viewer?: Viewer;
  onChanged?: () => void;
  notify?: (kind: "success" | "error", text: string) => void;
}

const when = (v: string | null | undefined) => (v ? formatDateTime(v) : "—");

/** TASK 10: the final report, a snapshot written when the request was closed. */
export default function ReportTab({ requestId, status, report, retry, viewer, onChanged, notify }: Props) {
  return (
    <section className="card" style={{ marginTop: 16 }} aria-busy={report.kind === "loading"}>
      <h2 className="card-title"><FileText size={20} />Final report</h2>
      {status !== "COMPLETED" && <p className="placeholder">The final report is created when the request is completed.</p>}
      {status === "COMPLETED" && (report.kind === "loading" || report.kind === "idle") && <p className="placeholder" role="status">Loading report…</p>}
      {status === "COMPLETED" && report.kind === "error" && (
        <div role="alert" className="notice error">
          <span>{report.message}</span>
          <button className="btn btn-outline" onClick={retry}>Try again</button>
        </div>
      )}
      {status === "COMPLETED" && report.kind === "ready" && (
        <div className="report">
          <h3>{report.data.request.requestNo} – {report.data.request.title}</h3>
          <p className="cell-sub">Closed by {report.data.completedByName} on {when(report.data.generatedAt)}</p>
          <h3>Summary</h3>
          <p>{report.data.summary}</p>
          {requestId && <ActivitySummary requestId={requestId} report={report.data} canEdit={!!viewer?.canEdit} onChanged={onChanged} notify={notify} />}
          {report.data.remainingIssues && (<><h3>Remaining issues</h3><p>{report.data.remainingIssues}</p></>)}
          <h3>Maintenance</h3>
          <p className="cell-sub">
            {[report.data.request.environment, report.data.request.cloudPlatform, report.data.request.maintenanceType].filter(Boolean).join(" · ") || "—"}
          </p>
          <h3>People</h3>
          <p className="cell-sub">
            Owner: {report.data.people.owner.displayName}. Participants: {report.data.people.participants.map((p) => p.displayName).join(", ") || "none"}.
            Approvers: {report.data.people.approvers.map((p) => p.displayName).join(", ") || "none"}.
          </p>
          <h3>Timeline</h3>
          <ul className="member-list" aria-label="Timeline">
            {([["Created", "createdAt"], ["Submitted", "submittedAt"], ["Approved", "approvedAt"], ["Scheduled", "scheduledAt"], ["Readiness started", "readinessStartedAt"], ["Maintenance started", "startedAt"], ["Validation started", "validationStartedAt"], ["Completed", "completedAt"]] as const).map(([label, key]) => (
              <li key={key}>{label}: {when(report.data.timeline[key])}</li>
            ))}
          </ul>
          <h3>Tasks ({report.data.tasks.done} of {report.data.tasks.total} done)</h3>
          <ul className="member-list" aria-label="Tasks">
            {report.data.tasks.items.map((t, i) => <li key={i}>{t.title} · {t.assignee} · {taskStatusLabel(t.status)}</li>)}
            {report.data.tasks.items.length === 0 && <li className="cell-sub">No tasks.</li>}
          </ul>
          <h3>Readiness ({report.data.readiness.resolved} of {report.data.readiness.total} resolved)</h3>
          <h3>Validation ({report.data.validation.passed} passed, {report.data.validation.failed} failed)</h3>
          <ul className="member-list" aria-label="Validation results">
            {report.data.validation.items.map((v) => <li key={v.domain}>{domainLabel(v.domain)}: {resultLabel(v.result)}{v.note ? ` – ${v.note}` : ""}</li>)}
          </ul>
          <h3>Issues ({report.data.activity.openIssues} open)</h3>
          <ul className="member-list" aria-label="Issues">
            {report.data.activity.issues.map((e, i) => <li key={i}>{e.severity} · {e.state}: {e.text}{e.resolutionNote ? ` (${e.resolutionNote})` : ""}</li>)}
            {report.data.activity.issues.length === 0 && <li className="cell-sub">No issues were reported.</li>}
          </ul>
        </div>
      )}
    </section>
  );
}

/** TASK 11: the activity summary. An AI draft is only a draft: a person reviews and saves it. */
function ActivitySummary({ requestId, report, canEdit, onChanged, notify }: { requestId: string; report: FinalReport; canEdit: boolean; onChanged?: () => void; notify?: Props["notify"] }) {
  const [language, setLanguage] = useState<SummaryLanguage>("en");
  const [draft, setDraft] = useState<string | null>(null);
  const [aiAssisted, setAiAssisted] = useState(false);
  const [busy, setBusy] = useState<"" | "generate" | "save">("");
  const [error, setError] = useState("");
  const saved = report.aiSummary;

  const generate = async () => {
    setBusy("generate");
    setError("");
    try {
      const res = await generateSummary(requestId, language);
      setDraft(res.draft);
      setAiAssisted(true);
    } catch (e) {
      setError(e instanceof ApiClientError && e.code === "AI_DISABLED" ? `${e.message}` : errorMessage(e));
    } finally {
      setBusy("");
    }
  };

  const save = async () => {
    if (!draft?.trim()) return setError("The summary is empty.");
    setBusy("save");
    setError("");
    try {
      await saveSummary(requestId, { text: draft.trim(), aiAssisted, language });
      setDraft(null);
      notify?.("success", "The summary was saved.");
      onChanged?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="card" aria-label="Activity summary" style={{ marginBottom: 12 }}>
      <h3><Sparkles size={16} /> Activity summary</h3>
      {saved && draft === null && (
        <>
          <p>{saved.text}</p>
          <p className="cell-sub">Reviewed by {saved.reviewedByName} on {when(saved.reviewedAt)}{saved.aiAssisted ? " · written with AI assistance" : ""}</p>
        </>
      )}
      {!saved && draft === null && <p className="cell-sub">No summary has been saved yet.</p>}
      {draft !== null && (
        <div className="field">
          <label htmlFor="summary-text">{aiAssisted ? "AI draft: review and edit before saving" : "Summary"}</label>
          <textarea id="summary-text" className="textarea" value={draft} maxLength={MAX_SUMMARY_TEXT} disabled={busy !== ""} onChange={(e) => setDraft(e.target.value)} />
        </div>
      )}
      {error && <p role="alert" className="notice error">{error}</p>}
      {canEdit && (
        <div className="card-actions">
          {draft === null ? (
            <>
              <select className="select" aria-label="Summary language" value={language} disabled={busy !== ""} onChange={(e) => setLanguage(e.target.value as SummaryLanguage)}>
                <option value="en">English</option>
                <option value="ar">العربية</option>
              </select>
              <button type="button" className="btn btn-outline" onClick={generate} disabled={busy !== ""}>{busy === "generate" ? "Writing…" : "Generate summary"}</button>
              <button type="button" className="btn btn-outline" onClick={() => { setDraft(saved?.text ?? ""); setAiAssisted(false); }} disabled={busy !== ""}>{saved ? "Edit summary" : "Write summary"}</button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-primary" onClick={save} disabled={busy !== ""}>{busy === "save" ? "Saving…" : "Save summary"}</button>
              <button type="button" className="btn btn-outline" onClick={() => { setDraft(null); setError(""); }} disabled={busy !== ""}>Discard</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
