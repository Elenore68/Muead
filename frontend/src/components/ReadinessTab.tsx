import { useState } from "react";
import { ClipboardCheck, Plus, Trash2 } from "lucide-react";
import { ApiClientError, errorMessage } from "../api/client";
import { checklistGroupLabel, itemStateLabel } from "../api/labels";
import { addItem, CHECKLIST_GROUPS, deleteItem, MAX_ITEM_NOTE, MAX_ITEM_TITLE, updateItem, type ChecklistGroup, type ChecklistItem, type ItemState, type Readiness } from "../api/readiness";
import type { ApiStatus } from "../api/requests";
import { canManageChecklist, canUpdateChecklist, type Viewer } from "../data/permissions";
import type { ResourceState } from "../data/useResource";
import ConfirmDialog from "./ConfirmDialog";
import Modal from "./Modal";
import TextActionDialog from "./TextActionDialog";

interface Props {
  requestId: string;
  status: ApiStatus;
  viewer: Viewer | undefined;
  readiness: ResourceState<Readiness>;
  retry: () => void;
  onChanged: () => void;
  notify: (kind: "success" | "error", text: string) => void;
}

/** TASK 08: the readiness checklist. Participants and the owner tick items; the request cannot start until all are resolved. */
export default function ReadinessTab({ requestId, status, viewer, readiness, retry, onChanged, notify }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notApplicable, setNotApplicable] = useState<ChecklistItem | null>(null);
  const [deleting, setDeleting] = useState<ChecklistItem | null>(null);
  const [adding, setAdding] = useState(false);
  const update = canUpdateChecklist(viewer, status);
  const manage = canManageChecklist(viewer, status);

  const setState = async (item: ChecklistItem, state: ItemState, note?: string) => {
    setBusyId(item.id);
    try {
      await updateItem(requestId, item.id, item.version, state, note);
    } catch (e) {
      notify("error", errorMessage(e));
      throw e;
    } finally {
      setBusyId(null);
      onChanged(); // also after a 409, so the list matches the server
    }
  };

  return (
    <section className="card" style={{ marginTop: 16 }} aria-busy={readiness.kind === "loading"}>
      <h2 className="card-title"><ClipboardCheck size={20} />Readiness checklist</h2>
      {(readiness.kind === "loading" || readiness.kind === "idle") && <p className="placeholder" role="status">Loading checklist…</p>}
      {readiness.kind === "error" && (
        <div role="alert" className="notice error">
          <span>{readiness.message}</span>
          <button className="btn btn-outline" onClick={retry}>Try again</button>
        </div>
      )}
      {readiness.kind === "ready" && !readiness.data.started && (
        <p className="placeholder">The checklist is created when the request moves to Readiness.</p>
      )}
      {readiness.kind === "ready" && readiness.data.started && (
        <>
          <div className="task-progress" role="group" aria-label="Readiness progress">
            <div className="task-bar" aria-hidden="true"><span style={{ width: `${readiness.data.progress.percent}%` }} /></div>
            <small>{readiness.data.progress.resolved} of {readiness.data.progress.total} items resolved ({readiness.data.progress.percent}%)</small>
          </div>
          {status === "READINESS" && readiness.data.progress.resolved < readiness.data.progress.total && (
            <p className="cell-sub">The maintenance cannot start until every item is done or not applicable.</p>
          )}
          {CHECKLIST_GROUPS.map((g) => {
            const items = readiness.data.items.filter((i) => i.group === g);
            if (!items.length) return null;
            return (
              <div key={g} className="check-group">
                <h3>{checklistGroupLabel(g)}</h3>
                <ul className="task-list" aria-label={checklistGroupLabel(g)}>
                  {items.map((i) => (
                    <li key={i.id} className={i.state === "DONE" ? "done" : ""}>
                      <div className="task-main">
                        <strong>{i.title}</strong>
                        {i.note && <div className="cell-sub">{i.state === "NOT_APPLICABLE" ? "Not applicable: " : ""}{i.note}</div>}
                        {i.updatedBy && <div className="cell-sub">Updated by {i.updatedBy.displayName}</div>}
                      </div>
                      <div className="task-actions">
                        {update ? (
                          <select className="select" aria-label={`State of ${i.title}`} value={i.state} disabled={busyId === i.id}
                            onChange={(e) => {
                              const next = e.target.value as ItemState;
                              if (next === "NOT_APPLICABLE") setNotApplicable(i);
                              else void setState(i, next).catch(() => {});
                            }}>
                            {(["PENDING", "DONE", "NOT_APPLICABLE"] as ItemState[]).map((s) => <option key={s} value={s}>{itemStateLabel(s)}</option>)}
                          </select>
                        ) : (
                          <span className={`pill ${i.state === "DONE" ? "st-done" : i.state === "PENDING" ? "st-pending" : "chip"}`}>{itemStateLabel(i.state)}</span>
                        )}
                        {manage && i.custom && (
                          <button type="button" className="icon-x" aria-label={`Delete ${i.title}`} title="Delete" onClick={() => setDeleting(i)}><Trash2 size={16} /></button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {manage && (
            <div className="card-actions">
              <button type="button" className="btn btn-outline" onClick={() => setAdding(true)}><Plus size={16} />Add item</button>
            </div>
          )}
        </>
      )}
      {notApplicable && (
        <TextActionDialog
          title="Mark as not applicable"
          intro={notApplicable.title}
          label="Reason" required maxLength={MAX_ITEM_NOTE} submitLabel="Mark not applicable" busyLabel="Saving…" tone="primary"
          onClose={() => setNotApplicable(null)}
          onSubmit={async (reason) => {
            await setState(notApplicable, "NOT_APPLICABLE", reason);
            setNotApplicable(null);
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete item" message={`Delete "${deleting.title}"? Template items cannot be deleted.`} confirmLabel="Delete" busyLabel="Deleting…"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await deleteItem(requestId, deleting.id);
            } catch (e) {
              if (e instanceof ApiClientError && e.status === 409) onChanged();
              throw e;
            }
            setDeleting(null);
            notify("success", "The item was deleted.");
            onChanged();
          }}
        />
      )}
      {adding && (
        <AddItemDialog
          onClose={() => setAdding(false)}
          onAdd={async (group, title) => {
            try {
              await addItem(requestId, group, title);
            } catch (e) {
              if (e instanceof ApiClientError && e.status === 409) onChanged();
              throw e;
            }
            setAdding(false);
            notify("success", "The item was added.");
            onChanged();
          }}
        />
      )}
    </section>
  );
}

function AddItemDialog({ onAdd, onClose }: { onAdd: (g: ChecklistGroup, title: string) => Promise<void>; onClose: () => void }) {
  const [group, setGroup] = useState<ChecklistGroup>("BACKUP");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title="Add checklist item" onClose={onClose} busy={busy}>
      <form
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim()) return setError("Title is required.");
          setBusy(true);
          setError("");
          try {
            await onAdd(group, title.trim());
          } catch (ex) {
            setError(ex instanceof Error ? ex.message : "The item could not be added.");
            setBusy(false);
          }
        }}
      >
        <div className="field"><label htmlFor="ci-group">Group</label>
          <select id="ci-group" className="select" value={group} disabled={busy} onChange={(e) => setGroup(e.target.value as ChecklistGroup)}>
            {CHECKLIST_GROUPS.map((g) => <option key={g} value={g}>{checklistGroupLabel(g)}</option>)}
          </select></div>
        <div className="field"><label htmlFor="ci-title">Title <span className="req">*</span></label>
          <input id="ci-title" className="input" value={title} maxLength={MAX_ITEM_TITLE} disabled={busy} onChange={(e) => setTitle(e.target.value)} /></div>
        {error && <p role="alert" className="notice error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Adding…" : "Add item"}</button>
        </div>
      </form>
    </Modal>
  );
}
