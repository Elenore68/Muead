import { useState } from "react";
import { Plus, Send, Undo2, X } from "lucide-react";
import { ApiClientError, errorMessage } from "../api/client";
import { MAX_REASON, setApprovalPolicy, submitRequest, withdrawRequest, type ApprovalPolicy } from "../api/approvals";
import { removeMember, type AssignableRole, type Member, type MembersResponse } from "../api/members";
import type { ApiStatus } from "../api/requests";
import { policyLabel, specialtyLabel } from "../api/labels";
import {
  activeApprovers,
  canChangeApprovers,
  canChangeParticipants,
  canChangePolicy,
  canSubmit,
  canWithdraw,
  type Viewer,
} from "../data/permissions";
import type { ResourceState } from "../data/useResource";
import AddMemberDialog from "./AddMemberDialog";
import ConfirmDialog from "./ConfirmDialog";
import TextActionDialog from "./TextActionDialog";
import { Person } from "./ui";

export interface ActivityContext {
  requestId: string;
  status: ApiStatus;
  version: number;
  policy: ApprovalPolicy;
  viewer: Viewer | undefined;
  callerId: string | undefined;
  members: ResourceState<MembersResponse>;
  retryMembers: () => void;
  /** Re-load request, members and history after any change (keeps the page on screen). */
  onChanged: () => void;
  /** Page-level success / warning notice. */
  notify: (kind: "success" | "error", text: string) => void;
}

/** 409 means the request or its members changed meanwhile: reload so the screen matches the server. */
const report = (ctx: ActivityContext, e: unknown) => {
  ctx.notify("error", errorMessage(e));
  if (e instanceof ApiClientError && e.status === 409) ctx.onChanged();
};

const memberRows = (ctx: ActivityContext, role: AssignableRole): Member[] =>
  ctx.members.kind === "ready" ? ctx.members.data.items.filter((m) => m.status === "ACTIVE" && m.activityRole === role) : [];

function MembersBody({ ctx, role, canChange, empty }: { ctx: ActivityContext; role: AssignableRole; canChange: boolean; empty: string }) {
  const [removing, setRemoving] = useState<Member | null>(null);
  if (ctx.members.kind === "loading" || ctx.members.kind === "idle") return <p className="cell-sub" role="status">Loading…</p>;
  if (ctx.members.kind === "error") {
    return (
      <div role="alert" className="notice error">
        <span>{ctx.members.message}</span>
        <button className="btn btn-outline" onClick={ctx.retryMembers}>Try again</button>
      </div>
    );
  }
  const rows = memberRows(ctx, role);
  return (
    <>
      {rows.length === 0 ? (
        <p className="cell-sub">{empty}</p>
      ) : (
        <ul className="member-list" aria-label={role === "APPROVER" ? "Approvers" : "Participants"}>
          {rows.map((m) => (
            <li key={m.userId}>
              <div className="member-main">
                <Person name={m.displayName} initials={m.initials} />
                {canChange && (
                  <button type="button" className="icon-x" onClick={() => setRemoving(m)} aria-label={`Remove ${m.displayName}`} title="Remove">
                    <X size={16} />
                  </button>
                )}
              </div>
              {(m.specialty || m.responsibilities) && (
                <div className="cell-sub">
                  {[specialtyLabel(m.specialty), m.responsibilities].filter(Boolean).join(" · ")}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {removing && (
        <ConfirmDialog
          title={`Remove ${role === "APPROVER" ? "approver" : "participant"}`}
          message={`Remove ${removing.displayName} from this request? Their past actions stay in the history.`}
          confirmLabel="Remove"
          busyLabel="Removing…"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            try {
              await removeMember(ctx.requestId, removing.userId);
            } catch (e) {
              if (e instanceof ApiClientError && e.status === 409) ctx.onChanged();
              throw e;
            }
            setRemoving(null);
            ctx.notify("success", `${removing.displayName} was removed.`);
            ctx.onChanged();
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ Approvers card (decision 7) */
export function ApproversCard({ ctx }: { ctx: ActivityContext }) {
  const [adding, setAdding] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [busy, setBusy] = useState<"" | "submit" | "policy">("");
  const members = ctx.members.kind === "ready" ? ctx.members.data.items : [];
  const max = ctx.members.kind === "ready" ? ctx.members.data.limits.maxApprovers : 20;
  const approverCount = activeApprovers(members).length;
  const changeApprovers = canChangeApprovers(ctx.viewer, ctx.status);
  const changePolicy = canChangePolicy(ctx.viewer, ctx.status);
  const submittable = canSubmit(ctx.viewer, ctx.status, members);
  const withdrawable = canWithdraw(ctx.viewer, ctx.status);

  const onSubmit = async () => {
    setBusy("submit");
    try {
      const res = await submitRequest(ctx.requestId, ctx.version);
      ctx.notify("success", `Submitted for approval (round ${res.approvalRound}, ${res.approvers} approver${res.approvers === 1 ? "" : "s"}).`);
      ctx.onChanged();
    } catch (e) {
      report(ctx, e);
    } finally {
      setBusy("");
    }
  };

  const onPolicy = async (policy: ApprovalPolicy) => {
    setBusy("policy");
    try {
      await setApprovalPolicy(ctx.requestId, policy, ctx.version);
      ctx.notify("success", `Approval policy: ${policyLabel(policy)}.`);
      ctx.onChanged();
    } catch (e) {
      report(ctx, e);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="card" aria-busy={busy !== ""}>
      <h3>Approvers</h3>
      {changePolicy ? (
        <div className="field" style={{ marginBottom: 8 }}>
          <label htmlFor="approval-policy">Approval policy</label>
          <select id="approval-policy" className="select" value={ctx.policy} disabled={busy !== ""} onChange={(e) => onPolicy(e.target.value as ApprovalPolicy)}>
            <option value="ANY_ONE">{policyLabel("ANY_ONE")}</option>
            <option value="ALL">{policyLabel("ALL")}</option>
          </select>
        </div>
      ) : (
        <p className="cell-sub" style={{ marginBottom: 8 }}>{policyLabel(ctx.policy)}</p>
      )}
      <MembersBody ctx={ctx} role="APPROVER" canChange={changeApprovers} empty="No approvers assigned yet." />
      {ctx.status === "PENDING_APPROVAL" && <p className="cell-sub">Approvers are locked while the request is waiting for approval.</p>}
      <div className="card-actions">
        {changeApprovers && approverCount < max && (
          <button type="button" className="btn btn-outline" onClick={() => setAdding(true)}><Plus size={16} />Add approver</button>
        )}
        {submittable && (
          <button type="button" className="btn btn-primary" onClick={onSubmit} disabled={busy !== ""}>
            <Send size={16} />{busy === "submit" ? "Submitting…" : "Submit for approval"}
          </button>
        )}
        {withdrawable && (
          <button type="button" className="btn btn-outline" onClick={() => setWithdrawing(true)}><Undo2 size={16} />Withdraw</button>
        )}
      </div>
      {!submittable && changeApprovers && approverCount === 0 && ctx.viewer?.canEdit && (
        <p className="cell-sub">Add at least one approver to submit this request.</p>
      )}
      {adding && (
        <AddMemberDialog requestId={ctx.requestId} role="APPROVER" members={members} callerId={ctx.callerId} onClose={() => setAdding(false)}
          onAdded={(m) => { setAdding(false); ctx.notify("success", `${m.displayName} was added as approver.`); ctx.onChanged(); }} />
      )}
      {withdrawing && (
        <TextActionDialog
          title="Withdraw request"
          intro="The request goes back to Draft. Pending approval decisions are closed; decisions already made stay in the history. You can then change approvers and submit again."
          label="Reason" required maxLength={MAX_REASON} submitLabel="Withdraw" busyLabel="Withdrawing…" tone="primary"
          onClose={() => setWithdrawing(false)}
          onSubmit={async (reason) => {
            try {
              await withdrawRequest(ctx.requestId, reason, ctx.version);
            } catch (e) {
              if (e instanceof ApiClientError && e.status === 409) ctx.onChanged();
              throw e;
            }
            setWithdrawing(false);
            ctx.notify("success", "The request was withdrawn and is a draft again.");
            ctx.onChanged();
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Participants card */
export function ParticipantsCard({ ctx }: { ctx: ActivityContext }) {
  const [adding, setAdding] = useState(false);
  const members = ctx.members.kind === "ready" ? ctx.members.data.items : [];
  const max = ctx.members.kind === "ready" ? ctx.members.data.limits.maxMembers : 50;
  const changeParticipants = canChangeParticipants(ctx.viewer, ctx.status);
  const activeCount = members.filter((m) => m.status === "ACTIVE").length;
  return (
    <div className="card">
      <h3>Participants</h3>
      <MembersBody ctx={ctx} role="PARTICIPANT" canChange={changeParticipants} empty="No participants yet." />
      {changeParticipants && activeCount < max && (
        <div className="card-actions">
          <button type="button" className="btn btn-outline" onClick={() => setAdding(true)}><Plus size={16} />Add participant</button>
        </div>
      )}
      {adding && (
        <AddMemberDialog requestId={ctx.requestId} role="PARTICIPANT" members={members} callerId={ctx.callerId} onClose={() => setAdding(false)}
          onAdded={(m) => { setAdding(false); ctx.notify("success", `${m.displayName} was added as participant.`); ctx.onChanged(); }} />
      )}
    </div>
  );
}
