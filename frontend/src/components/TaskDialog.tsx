import { useState, type FormEvent } from "react";
import { createTask, MAX_TASK_DESCRIPTION, MAX_TASK_TITLE, updateTask, type Task } from "../api/tasks";
import type { Member } from "../api/members";
import Modal from "./Modal";

interface Props {
  requestId: string;
  /** People who can be assigned (owner and participants who have not declined). */
  assignees: Member[];
  /** Present when editing. */
  task?: Task;
  onSaved: (kind: "created" | "updated") => void;
  onClose: () => void;
  /** Called on 409 so the page reloads. */
  onConflict: () => void;
}

/** Create or edit a task (owner / admin only). The backend re-checks the assignee. */
export default function TaskDialog({ requestId, assignees, task, onSaved, onClose, onConflict }: Props) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [assigneeId, setAssigneeId] = useState(task?.assignee.id ?? "");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Editing: keep the current assignee selectable even if they have since declined.
  const options = task && !assignees.some((m) => m.userId === task.assignee.id)
    ? [{ userId: task.assignee.id, displayName: task.assignee.displayName } as Pick<Member, "userId" | "displayName">, ...assignees]
    : assignees;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError("Title is required.");
    if (!assigneeId) return setError("Choose who is responsible for this task.");
    setBusy(true);
    setError("");
    try {
      if (task) {
        await updateTask(requestId, task.id, task.version, {
          title: title.trim(),
          description: description.trim() || null,
          assigneeId,
          dueDate: dueDate || null,
        });
      } else {
        await createTask(requestId, { title: title.trim(), assigneeId, ...(description.trim() ? { description: description.trim() } : {}), ...(dueDate ? { dueDate } : {}) });
      }
      onSaved(task ? "updated" : "created");
    } catch (ex) {
      if (ex && typeof ex === "object" && "status" in ex && (ex as { status: number }).status === 409) onConflict();
      setError(ex instanceof Error ? ex.message : "The task could not be saved.");
      setBusy(false);
    }
  };

  return (
    <Modal title={task ? "Edit task" : "New task"} onClose={onClose} busy={busy}>
      <form onSubmit={save} noValidate aria-busy={busy}>
        <div className="field"><label htmlFor="task-title">Title <span className="req">*</span></label>
          <input id="task-title" className="input" value={title} maxLength={MAX_TASK_TITLE} disabled={busy} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="field"><label htmlFor="task-desc">Description</label>
          <textarea id="task-desc" className="textarea" value={description} maxLength={MAX_TASK_DESCRIPTION} disabled={busy} onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="row3">
          <div className="field"><label htmlFor="task-assignee">Assigned to <span className="req">*</span></label>
            <select id="task-assignee" className="select" value={assigneeId} disabled={busy} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="" disabled>Select person</option>
              {options.map((m) => <option key={m.userId} value={m.userId}>{m.displayName}</option>)}
            </select></div>
          <div className="field"><label htmlFor="task-due">Due date</label>
            <input id="task-due" type="date" className="input" value={dueDate} disabled={busy} onChange={(e) => setDueDate(e.target.value)} /></div>
        </div>
        {assignees.length === 0 && <p className="cell-sub">Add a participant to the request first. Tasks go to the owner or participants.</p>}
        {error && <p role="alert" className="notice error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : task ? "Save changes" : "Create task"}</button>
        </div>
      </form>
    </Modal>
  );
}
