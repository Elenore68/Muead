import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, CheckCircle2, Filter, Hourglass, Search, X, XCircle } from "lucide-react";
import { Topbar } from "../components/Layout";
import { CategoryChip, Pager, Person, PriorityPill, StatusPill, Tabs } from "../components/ui";
import { approvals } from "../data/mock";
import { config } from "../config";
import { ApiClientError } from "../api/client";
import { decide, MAX_COMMENT, type ApprovalItem, type InboxDecision } from "../api/approvals";
import { blockedReasonLabel, decisionLabel, formatDateTime, priorityLabel } from "../api/labels";
import { INBOX_PAGE_SIZE, useApprovalInbox } from "../data/useApprovalInbox";
import TextActionDialog from "../components/TextActionDialog";
import { decisionResultText } from "../components/DecisionPanel";

const stats = [
  { n: 4, label: "Pending Approvals", icon: Hourglass, tone: "tone-orange" },
  { n: 8, label: "Approved", icon: CheckCircle2, tone: "tone-green" },
  { n: 2, label: "Rejected", icon: XCircle, tone: "tone-red" },
];

/** Mock mode: original page, unchanged. */
function MockApprovals() {
  const [tab, setTab] = useState("Pending (4)");
  const [items, setItems] = useState(approvals);
  const decide = (id: string) => setItems((xs) => xs.filter((x) => x.id !== id)); // mock only

  return (
    <>
      <Topbar title="Approvals" subtitle="Review and take action on maintenance requests." />
      <section className="stats c3" aria-label="Approval summary">
        {stats.map(({ n, label, icon: Icon, tone }) => (
          <div className="card stat" key={label}>
            <span className={`icon-tile ${tone}`}><Icon size={24} /></span>
            <div><div className="stat-num">{n}</div><div className="stat-label">{label}</div></div>
          </div>
        ))}
      </section>
      <div className="toolbar">
        <Tabs items={["Pending (4)", "Approved (8)", "Rejected (2)"]} active={tab} onChange={setTab} />
        <div className="toolbar-r">
          <label className="search"><Search size={18} /><span className="sr-only">Search requests</span><input placeholder="Search requests..." /></label>
          <button className="btn-icon" aria-label="Filter"><Filter size={18} /></button>
        </div>
      </div>
      <div className="card table-wrap">
        <table className="stack">
          <thead>
            <tr><th><input type="checkbox" aria-label="Select all" /></th><th>Request ID</th><th>Title</th><th>Requested by</th><th>Category</th><th>Priority</th><th>Requested on</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {tab.startsWith("Pending") ? items.map((a) => (
              <tr key={a.id}>
                <td><input type="checkbox" aria-label={`Select ${a.id}`} /></td>
                <td>{a.id}</td>
                <td><div style={{ fontWeight: 700 }}>{a.title}</div><div className="cell-sub">{a.description}</div></td>
                <td data-label="Requested by"><Person name={a.requestedBy} /></td>
                <td data-label="Category"><CategoryChip>{a.category}</CategoryChip></td>
                <td><PriorityPill priority={a.priority} /></td>
                <td data-label="Requested on">{a.requestedOn}</td>
                <td>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-approve" onClick={() => decide(a.id)}><Check size={16} />Approve</button>
                    <button className="btn btn-reject" onClick={() => decide(a.id)}><X size={16} />Reject</button>
                  </div>
                </td>
              </tr>
            )) : <tr><td colSpan={8} className="placeholder">Nothing to show in this tab yet.</td></tr>}
            {tab.startsWith("Pending") && items.length === 0 && <tr><td colSpan={8} className="placeholder">All caught up.</td></tr>}
          </tbody>
        </table>
        <div className="table-foot"><span>Showing {items.length ? 1 : 0}-{items.length} of {items.length} requests</span><Pager pages={1} /></div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ live mode */
const TAB_DEFS: { decision: InboxDecision; label: string; key: "pending" | "approved" | "rejected" }[] = [
  { decision: "PENDING", label: "Pending", key: "pending" },
  { decision: "APPROVED", label: "Approved", key: "approved" },
  { decision: "REJECTED", label: "Rejected", key: "rejected" },
];

const EMPTY: Record<InboxDecision, string> = {
  PENDING: "All caught up.",
  APPROVED: "No approved requests yet.",
  REJECTED: "No rejected requests yet.",
};

type Flash = { kind: "success" | "error"; text: string } | null;

/**
 * The caller's OWN approval records (GET /approvals, /approvals/summary). Approve/Reject appear only on rows
 * where the backend reports `canDecide`; the backend re-checks every decision anyway.
 */
function LiveApprovals() {
  const [decision, setDecision] = useState<InboxDecision>("PENDING");
  const [q, setQ] = useState("");
  const inbox = useApprovalInbox(decision, q);
  const [dialog, setDialog] = useState<{ item: ApprovalItem; decision: "APPROVED" | "REJECTED" } | null>(null);
  const [flash, setFlash] = useState<Flash>(null);

  const summary = inbox.summary.kind === "ready" ? inbox.summary.data : null;
  const tabLabel = (t: (typeof TAB_DEFS)[number]) => (summary ? `${t.label} (${summary[t.key]})` : t.label);
  const labels = TAB_DEFS.map(tabLabel);
  const activeLabel = tabLabel(TAB_DEFS.find((t) => t.decision === decision)!);
  const from = inbox.items.length ? inbox.page * INBOX_PAGE_SIZE + 1 : 0;
  const to = inbox.page * INBOX_PAGE_SIZE + inbox.items.length;
  const cards = [
    { n: summary?.pending, label: "Pending Approvals", icon: Hourglass, tone: "tone-orange" },
    { n: summary?.approved, label: "Approved", icon: CheckCircle2, tone: "tone-green" },
    { n: summary?.rejected, label: "Rejected", icon: XCircle, tone: "tone-red" },
  ];

  const submitDecision = (item: ApprovalItem, d: "APPROVED" | "REJECTED") => async (comment: string) => {
    try {
      const res = await decide(item.requestId, d, comment || undefined);
      setDialog(null);
      setFlash({ kind: "success", text: decisionResultText(item.requestNo, res) });
      inbox.reload();
    } catch (e) {
      // 409: already decided / no longer pending / concurrent change -> refresh so the list matches the server.
      if (e instanceof ApiClientError && e.status === 409) inbox.reload();
      throw e;
    }
  };

  return (
    <>
      <Topbar title="Approvals" subtitle="Review and take action on maintenance requests." />
      {flash && (
        <div role={flash.kind === "error" ? "alert" : "status"} className={`notice ${flash.kind}`}>
          <span>{flash.text}</span>
          <button className="btn btn-outline" onClick={() => setFlash(null)}>Dismiss</button>
        </div>
      )}
      {inbox.summary.kind === "error" && <div role="alert" className="notice warning"><span>Counts could not be loaded. The list below still works.</span></div>}
      <section className="stats c3" aria-label="Approval summary" aria-busy={inbox.summary.kind === "loading" || undefined}>
        {cards.map(({ n, label, icon: Icon, tone }) => (
          <div className="card stat" key={label}>
            <span className={`icon-tile ${tone}`}><Icon size={24} /></span>
            <div><div className="stat-num">{n ?? "—"}</div><div className="stat-label">{label}</div></div>
          </div>
        ))}
      </section>
      {inbox.error && (
        <div role="alert" className="notice error">
          <span>{inbox.error}</span>
          <button className="btn btn-outline" onClick={inbox.reload}>Try again</button>
        </div>
      )}
      <div className="toolbar">
        <Tabs items={labels} active={activeLabel} onChange={(l) => setDecision(TAB_DEFS[labels.indexOf(l)].decision)} />
        <div className="toolbar-r">
          <label className="search"><Search size={18} /><span className="sr-only">Search requests</span>
            <input placeholder="Search requests..." value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <button className="btn-icon" aria-label="Filter"><Filter size={18} /></button>
        </div>
      </div>
      <div className="card table-wrap" aria-busy={inbox.loading}>
        <table className="stack">
          <thead>
            <tr><th><input type="checkbox" aria-label="Select all" disabled title="Bulk decisions are not available" /></th><th>Request ID</th><th>Title</th><th>Requested by</th><th>Category</th><th>Priority</th><th>Requested on</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {inbox.items.map((a) => (
              <tr key={a.approvalId}>
                <td><input type="checkbox" aria-label={`Select ${a.requestNo}`} disabled /></td>
                <td><Link to={`/requests/${a.requestId}`} className="link">{a.requestNo}</Link></td>
                <td><div style={{ fontWeight: 700 }}>{a.title}</div><div className="cell-sub">{a.description}</div></td>
                <td data-label="Requested by"><Person name={a.requestedBy.displayName} initials={a.requestedBy.initials} /></td>
                <td data-label="Category"><CategoryChip>{a.category}</CategoryChip></td>
                <td><PriorityPill priority={priorityLabel(a.priority)} /></td>
                <td data-label="Requested on">{formatDateTime(a.submittedAt)}</td>
                <td>
                  {a.decision === "PENDING" && a.canDecide ? (
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn btn-approve" onClick={() => setDialog({ item: a, decision: "APPROVED" })} aria-label={`Approve ${a.requestNo}`}><Check size={16} />Approve</button>
                      <button className="btn btn-reject" onClick={() => setDialog({ item: a, decision: "REJECTED" })} aria-label={`Reject ${a.requestNo}`}><X size={16} />Reject</button>
                    </div>
                  ) : a.decision === "PENDING" ? (
                    <span className="cell-sub">{blockedReasonLabel(a.blockedReason)}</span>
                  ) : (
                    <div>
                      <StatusPill status={decisionLabel(a.decision)} />
                      <div className="cell-sub">
                        {a.decidedAt ? formatDateTime(a.decidedAt) : ""}
                        {a.requestStatus === "PENDING_APPROVAL" ? " · Request still waiting for other approvers" : ""}
                      </div>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {inbox.loading && inbox.items.length === 0 && <tr><td colSpan={8} className="placeholder" role="status">Loading approvals…</td></tr>}
            {!inbox.loading && !inbox.error && inbox.items.length === 0 && (
              <tr><td colSpan={8} className="placeholder">{inbox.searching ? "No requests match your search." : EMPTY[decision]}</td></tr>
            )}
          </tbody>
        </table>
        <div className="table-foot">
          <span>{inbox.loading && inbox.items.length === 0 ? "Loading…" : `Showing ${from}-${to} requests`}</span>
          <div className="pager" aria-label="Pagination">
            <button aria-label="Previous page" onClick={inbox.prev} disabled={inbox.page === 0 || inbox.loading}>‹</button>
            <button className="active" aria-current="page">{inbox.page + 1}</button>
            <button aria-label="Next page" onClick={inbox.next} disabled={!inbox.hasNext || inbox.loading}>›</button>
          </div>
        </div>
      </div>
      {dialog && (
        <TextActionDialog
          title={`${dialog.decision === "APPROVED" ? "Approve" : "Reject"} ${dialog.item.requestNo}`}
          intro={dialog.decision === "REJECTED" ? "Explain what needs to change. The owner sees this comment in the approval history." : undefined}
          label="Comment" required={dialog.decision === "REJECTED"} maxLength={MAX_COMMENT}
          submitLabel={dialog.decision === "APPROVED" ? "Approve" : "Reject"}
          busyLabel={dialog.decision === "APPROVED" ? "Approving…" : "Rejecting…"}
          tone={dialog.decision === "APPROVED" ? "approve" : "reject"}
          onClose={() => setDialog(null)}
          onSubmit={submitDecision(dialog.item, dialog.decision)}
        />
      )}
    </>
  );
}

// Chosen once at startup, like the other pages, so hook order never changes.
const Approvals = config.apiEnabled ? LiveApprovals : MockApprovals;
export default Approvals;
