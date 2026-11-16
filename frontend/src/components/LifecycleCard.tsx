import { useState } from "react";
import { Ban, Pencil, PlayCircle } from "lucide-react";
import { ApiClientError } from "../api/client";
import { advanceLabel, LIFECYCLE_STEPS, stageLabel } from "../api/labels";
import { cancelRequest, MAX_CANCEL_REASON, transitionRequest, type ApiStatus } from "../api/requests";
import { canEditRequest, lifecycleActions, type Viewer } from "../data/permissions";
import EditRequestDialog from "./EditRequestDialog";
import type { RequestFormValues } from "./RequestFields";
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
  const { next, canCancel } = lifecycleActions(viewer);
  const editable = canEditRequest(viewer, status);

  // Rejected sits after Pending Approval; Cancelled is an exit that leaves the path.
  const currentIndex = status === "REJECTED" ? LIFECYCLE_STEPS.indexOf("PENDING_APPROVAL") : LIFECYCLE_STEPS.indexOf(status);

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
      {status === "REJECTED" && <p className="cell-sub">Rejected. Edit the request and submit it again.</p>}
      {status === "CANCELLED" && (
        <p className="cell-sub">Cancelled{cancelReason ? `: ${cancelReason}` : "."} No further changes are possible.</p>
      )}
      {(next || editable || canCancel) && (
        <div className="side-actions">
          {next && (
            <button type="button" className="btn btn-primary" onClick={advance} disabled={busy}>
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
