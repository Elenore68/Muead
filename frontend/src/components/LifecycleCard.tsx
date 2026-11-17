import { useState } from "react";
import { Ban, Pencil, PlayCircle, Send, Undo2 } from "lucide-react";
import { ApiClientError } from "../api/client";
import { advanceLabel, LIFECYCLE_STEPS, stageLabel } from "../api/labels";
import { MAX_REMAINING, MAX_SUMMARY } from "../api/validation";
import { MAX_REASON, submitRequest, withdrawRequest } from "../api/approvals";
import { cancelRequest, MAX_CANCEL_REASON, transitionRequest, type ApiStatus } from "../api/requests";
import { canEditRequest, canSubmit, canWithdraw, lifecycleActions, type Viewer } from "../data/permissions";
import EditRequestDialog from "./EditRequestDialog";
import type { RequestFormValues } from "./RequestFields";
import Modal from "./Modal";
import TextActionDialog from "./TextActionDialog";

interface Props {
  requestId: string;
  status: ApiStatus;
  version: number;
  viewer: Viewer | undefined;
  fields: RequestFormValues;
  cancelReason?: string;
  onChanged: () => void;
  notify: (kind: "success" | "error", text: string) => void;
}

/**
 * TASK 06: where the request is in its life, and the actions the caller may take (next step, edit, cancel).
 * What is offered comes from the backend (`viewer.lifecycle`); the backend re-checks every call.
 */
export default function LifecycleCard({ requestId, status, version, viewer, fields, cancelReason, onChanged, notify }: Props) {
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const submittable = canSubmit(viewer, status);
  const withdrawable = canWithdraw(viewer, status);
  const { next, canCancel } = lifecycleActions(viewer);
  const editable = canEditRequest(viewer, status);

  // Rejected sits after Pending Approval; Cancelled is an exit that leaves the path.
  const currentIndex = status === "REJECTED" ? LIFECYCLE_STEPS.indexOf("PENDING_APPROVAL") : LIFECYCLE_STEPS.indexOf(status);

  /** Sends the request straight to the approval stage. The managers are picked by the backend; nobody chooses them. */
  const submit = async () => {
    setBusy(true);
    try {
      await submitRequest(requestId, version);
      notify("success", "The request was sent for approval.");
    } catch (e) {
      notify("error", e instanceof Error ? e.message : "The request could not be submitted.");
    } finally {
      setBusy(false);
      onChanged(); // also after a 409, so the page matches the server
    }
  };

  const advance = async () => {
    if (!next) return;
    setBusy(true);
    try {
      await transitionRequest(requestId, next, version);
      notify("success", `The request is now ${stageLabel(next)}.`);
    } catch (e) {
      notify("error", e instanceof Error ? e.message : "The status could not be changed.");
    } finally {
      setBusy(false);
      onChanged(); // also on 409: show the current state
    }
  };

  return (
    <div className="card" aria-label="Request lifecycle">
      <h3>Lifecycle</h3>
      <ol className="stepper">
        {LIFECYCLE_STEPS.map((s, i) => {
          const state = status === "CANCELLED" ? "off" : i < currentIndex ? "done" : i === currentIndex && status !== "REJECTED" ? "current" : "todo";
          return (
            <li key={s} className={`step ${state}`} aria-current={state === "current" ? "step" : undefined}>
              {stageLabel(s)}
            </li>
          );
        })}
      </ol>
      {status === "PENDING_APPROVAL" && <p className="cell-sub">Waiting for approval.</p>}
      {status === "REJECTED" && <p className="cell-sub">Rejected. Edit the request and submit it again.</p>}
      {status === "CANCELLED" && (
        <p className="cell-sub">Cancelled{cancelReason ? `: ${cancelReason}` : "."} No further changes are possible.</p>
      )}
      {(submittable || withdrawable || next || editable || canCancel) && (
        <div className="side-actions">
          {submittable && (
            <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
              <Send size={16} />{busy ? "Sending…" : "Submit for approval"}
            </button>
          )}
          {withdrawable && (
            <button type="button" className="btn btn-outline" onClick={() => setWithdrawing(true)} disabled={busy}>
              <Undo2 size={16} />Withdraw
            </button>
          )}
          {next && (
            <button type="button" className="btn btn-primary" onClick={next === "COMPLETED" ? () => setClosing(true) : advance} disabled={busy}>
              <PlayCircle size={16} />{busy ? "Updating…" : advanceLabel(next)}
            </button>
          )}
          {editable && (
            <button type="button" className="btn btn-outline" onClick={() => setEditing(true)} disabled={busy}>
              <Pencil size={16} />Edit request
            </button>
          )}
          {canCancel && (
            <button type="button" className="btn btn-reject" onClick={() => setCancelling(true)} disabled={busy}>
              <Ban size={16} />Cancel request
            </button>
          )}
        </div>
      )}
      {editing && (
        <EditRequestDialog
          requestId={requestId}
          version={version}
          initial={fields}
          onClose={() => setEditing(false)}
          onConflict={onChanged}
          onSaved={() => {
            setEditing(false);
            notify("success", "The request was updated.");
            onChanged();
          }}
        />
      )}
      {withdrawing && (
        <TextActionDialog
          title="Withdraw request"
          intro="The request goes back to Draft and the approval is cancelled. Decisions already made stay in the history. You can edit it and submit it again."
          label="Reason" required maxLength={MAX_REASON} submitLabel="Withdraw" busyLabel="Withdrawing…" tone="primary"
          onClose={() => setWithdrawing(false)}
          onSubmit={async (reason) => {
            try {
              await withdrawRequest(requestId, reason, version);
            } catch (e) {
              if (e instanceof ApiClientError && e.status === 409) onChanged();
              throw e;
            }
            setWithdrawing(false);
            notify("success", "The request was withdrawn and is a draft again.");
            onChanged();
          }}
        />
      )}
      {closing && (
        <CloseDialog
          onClose={() => setClosing(false)}
          onSubmit={async (summary, remainingIssues) => {
            try {
              await transitionRequest(requestId, "COMPLETED", version, { summary, remainingIssues });
            } catch (e) {
              if (e instanceof ApiClientError && e.status === 409) onChanged();
              throw e;
            }
            setClosing(false);
            notify("success", "The request is completed and the final report was created.");
            onChanged();
          }}
        />
      )}
      {cancelling && (
        <TextActionDialog
          title="Cancel request"
          intro="The request is closed and cannot be moved forward again. Everyone on it is notified. The reason stays in the history."
          label="Reason" required maxLength={MAX_CANCEL_REASON} submitLabel="Cancel request" busyLabel="Cancelling…" tone="reject"
          onClose={() => setCancelling(false)}
          onSubmit={async (reason) => {
            try {
              await cancelRequest(requestId, reason, version);
            } catch (e) {
              if (e instanceof ApiClientError && e.status === 409) onChanged();
              throw e;
            }
            setCancelling(false);
            notify("success", "The request was cancelled.");
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function CloseDialog({ onSubmit, onClose }: { onSubmit: (summary: string, remainingIssues?: string) => Promise<void>; onClose: () => void }) {
  const [summary, setSummary] = useState("");
  const [remaining, setRemaining] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title="Complete and close request" onClose={onClose} busy={busy}>
      <form
        noValidate
        aria-busy={busy}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!summary.trim()) return setError("Write a closing summary.");
          setBusy(true);
          setError("");
          try {
            await onSubmit(summary.trim(), remaining.trim() || undefined);
          } catch (ex) {
            setError(ex instanceof Error ? ex.message : "The request could not be completed.");
            setBusy(false);
          }
        }}
      >
        <p className="page-sub" style={{ marginBottom: 12 }}>Every validation check needs a result. The final report is created from this summary and everything recorded on the request, and cannot be changed afterwards.</p>
        <div className="field"><label htmlFor="close-summary">Closing summary <span className="req">*</span></label>
          <textarea id="close-summary" className="textarea" value={summary} maxLength={MAX_SUMMARY} disabled={busy} onChange={(e) => setSummary(e.target.value)} /></div>
        <div className="field"><label htmlFor="close-remaining">Remaining issues</label>
          <textarea id="close-remaining" className="textarea" value={remaining} maxLength={MAX_REMAINING} disabled={busy} placeholder="Required if a validation check failed or an issue is still open" onChange={(e) => setRemaining(e.target.value)} /></div>
        {error && <p role="alert" className="notice error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Completing…" : "Complete request"}</button>
        </div>
      </form>
    </Modal>
  );
}
