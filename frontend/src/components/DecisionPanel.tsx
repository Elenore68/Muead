import { useState } from "react";
import { Check, X } from "lucide-react";
import { ApiClientError } from "../api/client";
import { decide, MAX_COMMENT, type DecisionResult } from "../api/approvals";
import { decisionLabel, formatDateTime, statusLabel } from "../api/labels";
import TextActionDialog from "./TextActionDialog";

interface DecisionPanelProps {
  requestId: string;
  requestNo: string;
  /** From data/permissions canDecide(): only an assigned, eligible approver with a pending record. */
  canDecide: boolean;
  /** Caller's record in the current round, if any (to show "You approved on ..."). */
  myRecord?: { decision: string; decidedAt: string | null };
  onDecided: (r: DecisionResult) => void;
  /** Called on 409 so the page reloads the request state. */
  onConflict: () => void;
}

/**
 * Approve / Reject for the caller's OWN pending decision. Nothing is rendered for anyone else
 * (owners, participants, unassigned admins, viewers), so no decision control is ever shown to them.
 * Reject requires a comment (backend rule); approve takes an optional one.
 */
export default function DecisionPanel({ requestId, requestNo, canDecide, myRecord, onDecided, onConflict }: DecisionPanelProps) {
  const [open, setOpen] = useState<null | "APPROVED" | "REJECTED">(null);

  if (!canDecide) {
    if (myRecord && myRecord.decision !== "PENDING") {
      return (
        <p className="cell-sub">
          Your decision: {decisionLabel(myRecord.decision)}{myRecord.decidedAt ? ` on ${formatDateTime(myRecord.decidedAt)}` : ""}.
        </p>
      );
    }
    return null;
  }

  const submit = (decision: "APPROVED" | "REJECTED") => async (comment: string) => {
    try {
      const res = await decide(requestId, decision, comment || undefined);
      setOpen(null);
      onDecided(res);
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 409) onConflict();
      throw e;
    }
  };

  return (
    <>
      <div className="side-actions">
        <button className="btn btn-approve solid" onClick={() => setOpen("APPROVED")}><Check size={16} />Approve</button>
        <button className="btn btn-reject" onClick={() => setOpen("REJECTED")}><X size={16} />Reject</button>
      </div>
      {open === "APPROVED" && (
        <TextActionDialog title={`Approve ${requestNo}`} label="Comment" required={false} maxLength={MAX_COMMENT}
          submitLabel="Approve" busyLabel="Approving…" tone="approve" onClose={() => setOpen(null)} onSubmit={submit("APPROVED")} />
      )}
      {open === "REJECTED" && (
        <TextActionDialog title={`Reject ${requestNo}`} label="Comment" required maxLength={MAX_COMMENT}
          intro="Explain what needs to change. The owner sees this comment in the approval history."
          submitLabel="Reject" busyLabel="Rejecting…" tone="reject" onClose={() => setOpen(null)} onSubmit={submit("REJECTED")} />
      )}
    </>
  );
}

/** Human result text after a decision (ANY_ONE rejections can leave the request pending). */
export const decisionResultText = (requestNo: string, r: DecisionResult): string => {
  const what = r.decision === "APPROVED" ? "approved" : "rejected";
  if (r.requestStatus === "PENDING_APPROVAL") {
    return `You ${what} ${requestNo}. The request is still waiting for other approvers.`;
  }
  return `You ${what} ${requestNo}. The request is now ${statusLabel(r.requestStatus).toLowerCase()}.`;
};
