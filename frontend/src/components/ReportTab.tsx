import { FileText } from "lucide-react";
import { domainLabel, formatDateTime, resultLabel, taskStatusLabel } from "../api/labels";
import type { FinalReport } from "../api/validation";
import type { ApiStatus } from "../api/requests";
import type { ResourceState } from "../data/useResource";

interface Props {
  status: ApiStatus;
  report: ResourceState<FinalReport>;
  retry: () => void;
}

const when = (v: string | null | undefined) => (v ? formatDateTime(v) : "—");

/** TASK 10: the final report, a snapshot written when the request was closed. */
export default function ReportTab({ status, report, retry }: Props) {
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
