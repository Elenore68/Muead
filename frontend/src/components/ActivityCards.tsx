import { useState } from "react";
import { Check, Pencil, Plus, X } from "lucide-react";
import { ApiClientError, errorMessage } from "../api/client";
import type { ApprovalPolicy } from "../api/approvals";
import { MAX_PARTICIPATION_NOTE, removeMember, respondToParticipation, type AssignableRole, type Member, type MembersResponse } from "../api/members";
import type { ApiStatus } from "../api/requests";
import { participationLabel, specialtyLabel } from "../api/labels";
import {
  canChangeParticipants,
  canEditMemberDetails,
  canRespondToParticipation,
  type Viewer,
} from "../data/permissions";
import type { ResourceState } from "../data/useResource";
import AddMemberDialog from "./AddMemberDialog";
import ConfirmDialog from "./ConfirmDialog";
import MemberDetailsDialog from "./MemberDetailsDialog";
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
  const [editing, setEditing] = useState<Member | null>(null);
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
                <span style={{ display: "flex", gap: 2 }}>
                  {canEditMemberDetails(ctx.viewer, ctx.status, m) && (
                    <button type="button" className="icon-x" onClick={() => setEditing(m)} aria-label={`Edit ${m.displayName}`} title="Edit details">
                      <Pencil size={16} />
                    </button>
                  )}
                  {canChange && (
                    <button type="button" className="icon-x" onClick={() => setRemoving(m)} aria-label={`Remove ${m.displayName}`} title="Remove">
                      <X size={16} />
                    </button>
                  )}
                </span>
              </div>
              {m.activityRole === "PARTICIPANT" && m.participation && (
                <div>
                  <span className={`pill ${m.participation === "DECLINED" ? "st-rejected" : m.participation === "CONFIRMED" ? "st-done" : "st-pending"}`}>
                    {participationLabel(m.participation)}
                  </span>
                  {m.participation === "DECLINED" && m.participationNote && <span className="cell-sub"> {m.participationNote}</span>}
                </div>
              )}
              {(m.specialty || m.responsibilities) && (
                <div className="cell-sub">
                  {[specialtyLabel(m.specialty), m.responsibilities].filter(Boolean).join(" · ")}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <MemberDetailsDialog
          requestId={ctx.requestId}
          member={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            ctx.notify("success", `${editing.displayName} was updated.`);
            ctx.onChanged();
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title="Remove participant"
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

/* ------------------------------------------------------------------ Participants card */
export function ParticipantsCard({ ctx }: { ctx: ActivityContext }) {
  const [adding, setAdding] = useState(false);
  const members = ctx.members.kind === "ready" ? ctx.members.data.items : [];
  const max = ctx.members.kind === "ready" ? ctx.members.data.limits.maxMembers : 50;
  const changeParticipants = canChangeParticipants(ctx.viewer, ctx.status);
  const activeCount = members.filter((m) => m.status === "ACTIVE").length;
  const me = members.find((m) => m.userId === ctx.callerId && m.status === "ACTIVE");
  const [answering, setAnswering] = useState<"" | "CONFIRMED">("");
  const [declining, setDeclining] = useState(false);
  const canAnswer = canRespondToParticipation(me, ctx.callerId, ctx.status);
  const confirm = async () => {
    setAnswering("CONFIRMED");
    try {
      await respondToParticipation(ctx.requestId, "CONFIRMED");
      ctx.notify("success", "Your participation is confirmed.");
      ctx.onChanged();
    } catch (e) {
      report(ctx, e);
    } finally {
      setAnswering("");
    }
  };
  return (
    <div className="card">
      <h3>Participants</h3>
      <MembersBody ctx={ctx} role="PARTICIPANT" canChange={changeParticipants} empty="No participants yet." />
      {canAnswer && (
        <div className="part-answer" role="group" aria-label="Your participation">
          <span className="cell-sub">
            {me?.participation === "CONFIRMED" ? "You confirmed." : me?.participation === "DECLINED" ? "You declined." : "Will you take part?"}
          </span>
          {me?.participation !== "CONFIRMED" && (
            <button type="button" className="btn btn-primary" onClick={confirm} disabled={answering !== ""}>
              <Check size={16} />{answering ? "Saving…" : "Confirm participation"}
            </button>
          )}
          {me?.participation !== "DECLINED" && (
            <button type="button" className="btn btn-outline" onClick={() => setDeclining(true)} disabled={answering !== ""}>Decline</button>
          )}
        </div>
      )}
      {declining && (
        <TextActionDialog
          title="Decline participation"
          intro="You stay on the request until the owner removes you, and the owner is told. You will not be given new tasks. You can confirm later."
          label="Note" required={false} maxLength={MAX_PARTICIPATION_NOTE} submitLabel="Decline" busyLabel="Saving…" tone="reject"
          onClose={() => setDeclining(false)}
          onSubmit={async (note) => {
            try {
              await respondToParticipation(ctx.requestId, "DECLINED", note || undefined);
            } catch (e) {
              if (e instanceof ApiClientError && e.status === 409) ctx.onChanged();
              throw e;
            }
            setDeclining(false);
            ctx.notify("success", "You declined to participate. The owner was notified.");
            ctx.onChanged();
          }}
        />
      )}
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
