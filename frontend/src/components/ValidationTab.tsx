import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { errorMessage } from "../api/client";
import { domainLabel, resultLabel } from "../api/labels";
import type { ApiStatus } from "../api/requests";
import { MAX_NOTE, setResult, type Result, type ValidationItem, type ValidationState } from "../api/validation";
import { canRecordValidation, type Viewer } from "../data/permissions";
import type { ResourceState } from "../data/useResource";
import TextActionDialog from "./TextActionDialog";

interface Props {
  requestId: string;
  status: ApiStatus;
  viewer: Viewer | undefined;
  validation: ResourceState<ValidationState>;
  retry: () => void;
  onChanged: () => void;
  notify: (kind: "success" | "error", text: string) => void;
}

const RESULTS: Result[] = ["PENDING", "PASSED", "FAILED", "NOT_APPLICABLE"];

/** TASK 10: post-maintenance validation, one result per domain. The request cannot be closed until all have a result. */
export default function ValidationTab({ requestId, status, viewer, validation, retry, onChanged, notify }: Props) {
  const record = canRecordValidation(viewer, status);
  const [busy, setBusy] = useState<string | null>(null);
  const [needsNote, setNeedsNote] = useState<{ item: ValidationItem; result: "FAILED" | "NOT_APPLICABLE" } | null>(null);

  const save = async (item: ValidationItem, result: Result, note?: string) => {
    setBusy(item.domain);
    try {
      await setResult(requestId, item.domain, item.version, result, note);
    } catch (e) {
      notify("error", errorMessage(e));
      throw e;
    } finally {
      setBusy(null);
      onChanged();
    }
  };

  return (
    <section className="card" style={{ marginTop: 16 }} aria-busy={validation.kind === "loading"}>
      <h2 className="card-title"><ShieldCheck size={20} />Post-maintenance validation</h2>
      {(validation.kind === "loading" || validation.kind === "idle") && <p className="placeholder" role="status">Loading validation…</p>}
      {validation.kind === "error" && (
        <div role="alert" className="notice error">
          <span>{validation.message}</span>
          <button className="btn btn-outline" onClick={retry}>Try again</button>
        </div>
      )}
      {validation.kind === "ready" && !validation.data.started && <p className="placeholder">The validation checks are created when the request moves to Validation.</p>}
      {validation.kind === "ready" && validation.data.started && (
        <>
          <div className="task-progress" role="group" aria-label="Validation progress">
            <div className="task-bar" aria-hidden="true"><span style={{ width: `${validation.data.progress.percent}%` }} /></div>
            <small>{validation.data.progress.resolved} of {validation.data.progress.total} checks have a result{validation.data.progress.failed ? ` · ${validation.data.progress.failed} failed` : ""}</small>
          </div>
          <ul className="task-list" aria-label="Validation checks">
            {validation.data.items.map((i) => (
              <li key={i.domain}>
                <div className="task-main">
                  <strong>{domainLabel(i.domain)}</strong>
                  <div className="cell-sub">{i.title}</div>
                  {i.note && <div className="cell-sub">{i.note}</div>}
                  {i.updatedBy && <div className="cell-sub">Recorded by {i.updatedBy.displayName}</div>}
                </div>
                <div className="task-actions">
                  {record ? (
                    <select className="select" aria-label={`Result for ${domainLabel(i.domain)}`} value={i.result} disabled={busy === i.domain}
                      onChange={(e) => {
                        const next = e.target.value as Result;
                        if (next === "FAILED" || next === "NOT_APPLICABLE") setNeedsNote({ item: i, result: next });
                        else void save(i, next).catch(() => {});
                      }}>
                      {RESULTS.map((r) => <option key={r} value={r}>{resultLabel(r)}</option>)}
                    </select>
                  ) : (
                    <span className={`pill ${i.result === "PASSED" ? "st-done" : i.result === "FAILED" ? "st-rejected" : i.result === "PENDING" ? "st-pending" : "chip"}`}>{resultLabel(i.result)}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {needsNote && (
        <TextActionDialog
          title={needsNote.result === "FAILED" ? "Mark as failed" : "Mark as not applicable"}
          intro={`${domainLabel(needsNote.item.domain)}: ${needsNote.item.title}`}
          label={needsNote.result === "FAILED" ? "What failed?" : "Reason"} required maxLength={MAX_NOTE}
          submitLabel={needsNote.result === "FAILED" ? "Mark failed" : "Mark not applicable"} busyLabel="Saving…" tone={needsNote.result === "FAILED" ? "reject" : "primary"}
          onClose={() => setNeedsNote(null)}
          onSubmit={async (note) => {
            await save(needsNote.item, needsNote.result, note);
            setNeedsNote(null);
          }}
        />
      )}
    </section>
  );
}
