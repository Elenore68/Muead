import { useCallback, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Calendar, Check, Download, FileText, Flag, Layers, Link2, MoreVertical, Paperclip, X } from "lucide-react";
import { Topbar } from "../components/Layout";
import { Person, PriorityPill, StatusPill, Tabs } from "../components/ui";
import { config } from "../config";
import { errorMessage } from "../api/client";
import { getDownloadUrl, type Attachment } from "../api/requests";
import { formatDate } from "../api/labels";
import { useAuth } from "../auth/AuthContext";
import { useAttachments, useRequestDetails, type RequestView } from "../data/useRequestDetails";
import { useApprovalHistory, useMembers } from "../data/useActivity";
import { canDecide, myCurrentRecord } from "../data/permissions";
import { ApproversCard, ParticipantsCard, type ActivityContext } from "../components/ActivityCards";
import ApprovalHistory from "../components/ApprovalHistory";
import DecisionPanel, { decisionResultText } from "../components/DecisionPanel";

const TABS = ["Details", "Activity", "Approvals", "Attachments"];

export default function RequestDetails() {
  const { id = "" } = useParams();
  // key: a different id gets fresh state (details, tabs, attachments, members, approvals).
  return <RequestDetailsView key={id} id={id} />;
}

type Flash = { kind: "success" | "error"; text: string } | null;

function RequestDetailsView({ id }: { id: string }) {
  const nav = useNavigate();
  const [tab, setTab] = useState("Details");
  const { state, retry, refresh } = useRequestDetails(id);
  // Loaded the first time the Attachments tab is opened; kept while switching tabs.
  const attachments = useAttachments(id, tab === "Attachments");
  // Live mode only (disabled, no request, in mock mode).
  const members = useMembers(id);
  const history = useApprovalHistory(id);
  const { profile } = useAuth();
  const [flash, setFlash] = useState<Flash>(null);

  const refreshAll = useCallback(() => {
    void refresh();
    members.refresh();
    history.refresh();
  }, [refresh, members.refresh, history.refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.kind === "loading") {
    return (
      <>
        <Topbar crumbs="Requests > …" title="" />
        <div className="card placeholder" role="status">Loading request…</div>
      </>
    );
  }
  if (state.kind === "error") {
    return (
      <>
        <Topbar crumbs="Requests" title="Request details" />
        <div role="alert" className="notice error">
          <span>{state.message}</span>
          <button className="btn btn-outline" onClick={retry}>Try again</button>
        </div>
        <Link to="/requests" className="link">Back to requests</Link>
      </>
    );
  }
  if (state.kind === "notFound") {
    return (
      <>
        <Topbar title="Request not found" />
        <div className="card placeholder">
          {config.apiEnabled ? "This request does not exist, or you do not have access to it." : `No request with ID ${id}.`}{" "}
          <Link to="/requests" className="link">Back to requests</Link>
        </div>
      </>
    );
  }

  const r = state.data;
  const live = r.live;
  const rows = [
    { icon: FileText, label: "Title", value: r.title },
    { icon: FileText, label: "Description", value: r.description },
    { icon: Layers, label: "Category", value: r.category ?? "—" },
    { icon: Flag, label: "Priority", value: <PriorityPill priority={r.priority} /> },
    { icon: Calendar, label: "Target Date", value: r.targetDate ?? "—" },
    // Extra SOW fields: only present when the API returns them, so the original layout is unchanged otherwise.
    ...r.extra.map((x) => ({ icon: FileText, label: x.label, value: x.value })),
    ...(r.links.length
      ? [{
          icon: Link2,
          label: "Links",
          value: (
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {r.links.map((l, i) => <a key={`${i}-${l.url}`} href={l.url} target="_blank" rel="noopener noreferrer" className="link">{l.label}</a>)}
            </span>
          ),
        }]
      : []),
  ];

  // Live-mode activity context: everything is scoped to THIS request (viewer block + members), never global roles.
  const historyData = history.state.kind === "ready" ? history.state.data : null;
  const ctx: ActivityContext | null = live
    ? {
        requestId: live.id,
        status: live.status,
        version: live.version,
        policy: live.approvalPolicy,
        viewer: live.viewer,
        callerId: profile?.id,
        members: members.state,
        retryMembers: members.retry,
        onChanged: refreshAll,
        notify: (kind, text) => setFlash({ kind, text }),
      }
    : null;
  const decisionAllowed = live
    ? canDecide({ status: live.status, viewer: live.viewer, history: historyData, userId: profile?.id, orgRoles: profile?.roles })
    : false;
  const myRecord = live ? myCurrentRecord(historyData, profile?.id) : undefined;

  return (
    <>
      <Topbar crumbs={`Requests > ${r.displayId}`} title="" />
      <div className="detail-head">
        <button className="btn-icon" aria-label="Back" onClick={() => nav(-1)}><ArrowLeft size={18} /></button>
        <h1>{r.displayId} – {r.title}</h1>
        <div className="sp"><StatusPill status={r.status} /><button className="btn-icon" aria-label="More"><MoreVertical size={18} /></button></div>
      </div>
      {flash && (
        <div role={flash.kind === "error" ? "alert" : "status"} className={`notice ${flash.kind}`}>
          <span>{flash.text}</span>
          <button className="btn btn-outline" onClick={() => setFlash(null)}>Dismiss</button>
        </div>
      )}
      <Tabs items={TABS} active={tab} onChange={setTab} />
      {tab === "Attachments" && config.apiEnabled ? (
        <AttachmentsTab requestId={id} owner={r.owner} {...attachments} />
      ) : tab === "Approvals" && live ? (
        <ApprovalHistory state={history.state} onRetry={history.retry} />
      ) : tab !== "Details" ? (
        <div className="card placeholder" style={{ marginTop: 16 }}>
          {config.apiEnabled
            ? `The ${tab} tab is not available yet. Its backend endpoint has not been built.`
            : `The ${tab} tab is not in the design reference yet.`}
        </div>
      ) : (
        <div className="detail-layout">
          <section className="card">
            <h2 className="card-title">Request Information</h2>
            {rows.map(({ icon: Icon, label, value }) => (
              <div className="info-row" key={label}>
                <span className="icon-tile"><Icon size={18} /></span>
                <div><small>{label}</small>{value}</div>
              </div>
            ))}
          </section>
          <div className="side-stack">
            <div className="card"><h3>Requested by</h3><Person name={r.owner.name} initials={r.owner.initials} /></div>
            <div className="card"><h3>Status</h3><StatusPill status={r.status} /></div>
            <div className="card"><h3>Created on</h3>{r.createdOn}</div>
            {ctx && live ? (
              <>
                <ApproversCard ctx={ctx} />
                <ParticipantsCard ctx={ctx} />
                {/* Only an assigned, eligible approver with a pending decision gets controls. */}
                <DecisionPanel
                  requestId={live.id}
                  requestNo={r.displayId}
                  canDecide={decisionAllowed}
                  myRecord={myRecord}
                  onConflict={refreshAll}
                  onDecided={(res) => {
                    setFlash({ kind: "success", text: decisionResultText(r.displayId, res) });
                    refreshAll();
                  }}
                />
              </>
            ) : (
              // Mock mode: original design, unchanged.
              <div className="side-actions">
                <button className="btn btn-approve solid"><Check size={16} />Approve</button>
                <button className="btn btn-reject"><X size={16} />Reject</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

const size = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

interface AttachmentsTabProps extends ReturnType<typeof useAttachments> {
  requestId: string;
  owner: RequestView["owner"];
}

function AttachmentsTab({ requestId, owner, state, retry }: AttachmentsTabProps) {
  const { profile } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState("");

  // The API only returns the uploader's user id; names are known only for the owner and the current user.
  const uploader = (a: Attachment) => (a.uploadedBy === profile?.id ? "You" : a.uploadedBy === owner.id ? owner.name : "Team member");

  const download = async (a: Attachment) => {
    setBusy(a.id);
    setDownloadError("");
    try {
      const { url } = await getDownloadUrl(requestId, a.id);
      // Only follow https URLs (pre-signed S3 links); never javascript:, data:, etc.
      if (new URL(url).protocol !== "https:") throw new Error("The download link was not valid.");
      // The pre-signed URL forces "attachment", so the browser downloads without leaving the page.
      window.location.assign(url);
    } catch (e) {
      setDownloadError(`${a.fileName}: ${errorMessage(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card" style={{ marginTop: 16 }} aria-busy={!state || state.kind === "loading"}>
      <h2 className="card-title"><Paperclip size={20} />Attachments</h2>
      {(!state || state.kind === "loading") && <p className="placeholder" role="status">Loading attachments…</p>}
      {state?.kind === "error" && (
        <div role="alert" className="notice error" style={{ marginTop: 12 }}>
          <span>{state.message}</span>
          <button className="btn btn-outline" onClick={retry}>Try again</button>
        </div>
      )}
      {state?.kind === "ready" && state.data.length === 0 && <p className="placeholder">No attachments yet.</p>}
      {state?.kind === "ready" && state.data.length > 0 && (
        <ul className="file-list" aria-label="Attachments">
          {state.data.map((a) => (
            <li key={a.id}>
              <span>
                {a.fileName} <small>({size(a.sizeBytes)})</small>
                <br /><small className="cell-sub">{uploader(a)} · {formatDate(a.uploadedAt)}</small>
              </span>
              <button type="button" className="btn btn-outline" style={{ color: "var(--c-text)", background: "#fff", border: "1px solid var(--c-border)", padding: "6px 12px" }}
                onClick={() => download(a)} disabled={busy !== null} aria-label={`Download ${a.fileName}`}>
                <Download size={16} />{busy === a.id ? "Preparing…" : "Download"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {downloadError && <p role="alert" className="notice error" style={{ marginTop: 12 }}>{downloadError}</p>}
    </section>
  );
}
