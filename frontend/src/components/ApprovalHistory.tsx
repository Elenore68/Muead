import type { ApprovalHistory as History } from "../api/approvals";
import { activityRoleLabel, decisionLabel, formatDateTime, policyLabel, roundStatusLabel } from "../api/labels";
import type { ResourceState } from "../data/useResource";
import { Person, StatusPill } from "./ui";

/** Approvals tab: every round (newest first) with assigned approvers, decisions, comments and times. */
export default function ApprovalHistory({ state, onRetry }: { state: ResourceState<History>; onRetry: () => void }) {
  if (state.kind === "loading" || state.kind === "idle") return <div className="card placeholder" role="status" style={{ marginTop: 16 }}>Loading approval history…</div>;
  if (state.kind === "error") {
    return (
      <div role="alert" className="notice error" style={{ marginTop: 16 }}>
        <span>{state.message}</span>
        <button className="btn btn-outline" onClick={onRetry}>Try again</button>
      </div>
    );
  }
  const h = state.data;
  if (h.rounds.length === 0) {
    return <div className="card placeholder" style={{ marginTop: 16 }}>This request has not been submitted for approval yet.</div>;
  }
  return (
    <div className="history" style={{ marginTop: 16 }}>
      {h.rounds.map((r) => (
        <section className="card" key={r.round} aria-labelledby={`round-${r.round}`}>
          <div className="card-head">
            <h2 className="card-title" id={`round-${r.round}`}>Round {r.round}</h2>
            <StatusPill status={roundStatusLabel(r.status)} />
          </div>
          <p className="cell-sub" style={{ marginBottom: 12 }}>
            {policyLabel(r.policy)} · Submitted by {r.submittedBy.displayName} ({activityRoleLabel(r.submittedBy.activityRole)}) on {formatDateTime(r.submittedAt)}
            {r.decidedAt ? ` · Closed ${formatDateTime(r.decidedAt)}` : ""}
          </p>
          <ul className="member-list" aria-label={`Approvers in round ${r.round}`}>
            {r.approvers.map((a) => (
              <li key={a.userId}>
                <div className="member-main">
                  <Person name={a.displayName} initials={a.initials} />
                  <StatusPill status={decisionLabel(a.decision)} />
                </div>
                {(a.decidedAt || a.comment) && (
                  <div className="cell-sub">
                    {a.decidedAt ? formatDateTime(a.decidedAt) : ""}
                    {a.comment ? <q style={{ display: "block", marginTop: 2 }}>{a.comment}</q> : null}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
