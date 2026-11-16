import { useState } from "react";
import { ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import { ApiClientError, errorMessage } from "../api/client";
import { formatDate, taskStatusLabel } from "../api/labels";
import type { Member } from "../api/members";
import type { ApiStatus } from "../api/requests";
import { deleteTask, updateTask, type Task, type TaskList, type TaskStatus } from "../api/tasks";
import { assignableToTasks, canChangeTaskStatus, canManageTasks, type Viewer } from "../data/permissions";
import type { ResourceState } from "../data/useResource";
import ConfirmDialog from "./ConfirmDialog";
import TaskDialog from "./TaskDialog";
import { Person } from "./ui";

interface Props {
  requestId: string;
  status: ApiStatus;
  viewer: Viewer | undefined;
  userId: string | undefined;
  tasks: ResourceState<TaskList>;
  members: Member[];
  retry: () => void;
  /** Reload tasks (and the rest of the page) after a change. */
  onChanged: () => void;
  notify: (kind: "success" | "error", text: string) => void;
}

const STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS", "DONE"];

/** TASK 07: tasks of this request with progress. Owner/admin manage; assignees change the status of their own tasks. */
export default function TasksTab({ requestId, status, viewer, userId, tasks, members, retry, onChanged, notify }: Props) {
  const [dialog, setDialog] = useState<{ task?: Task } | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const manage = canManageTasks(viewer, status);

  const setStatus = async (t: Task, next: TaskStatus) => {
    setBusyId(t.id);
    try {
      await updateTask(requestId, t.id, t.version, { status: next });
      notify("success", `"${t.title}" is now ${taskStatusLabel(next).toLowerCase()}.`);
    } catch (e) {
      notify("error", errorMessage(e));
    } finally {
      setBusyId(null);
      onChanged(); // also after a 409, so the list matches the server
    }
  };

  return (
    <section className="card" style={{ marginTop: 16 }} aria-busy={tasks.kind === "loading"}>
      <h2 className="card-title"><ListChecks size={20} />Tasks</h2>
      {(tasks.kind === "loading" || tasks.kind === "idle") && <p className="placeholder" role="status">Loading tasks…</p>}
      {tasks.kind === "error" && (
        <div role="alert" className="notice error">
          <span>{tasks.message}</span>
          <button className="btn btn-outline" onClick={retry}>Try again</button>
        </div>
      )}
      {tasks.kind === "ready" && (
        <>
          <div className="task-progress" role="group" aria-label="Task progress">
            <div className="task-bar" aria-hidden="true"><span style={{ width: `${tasks.data.progress.percent}%` }} /></div>
            <small>
              {tasks.data.progress.total === 0
                ? "No tasks yet."
                : `${tasks.data.progress.done} of ${tasks.data.progress.total} done (${tasks.data.progress.percent}%)`}
            </small>
          </div>
          {tasks.data.items.length > 0 && (
            <ul className="task-list" aria-label="Tasks">
              {tasks.data.items.map((t) => {
                const canStatus = canChangeTaskStatus(viewer, status, t.assignee.id, userId);
                return (
                  <li key={t.id} className={t.status === "DONE" ? "done" : ""}>
                    <div className="task-main">
                      <strong>{t.title}</strong>
                      {t.description && <div className="cell-sub">{t.description}</div>}
                      <div className="task-meta">
                        <Person name={t.assignee.displayName} initials={t.assignee.initials} />
                        {t.dueDate && <span className={`pill ${t.overdue ? "st-rejected" : "chip"}`}>{t.overdue ? "Overdue · " : "Due "}{formatDate(`${t.dueDate}T00:00:00`)}</span>}
                      </div>
                    </div>
                    <div className="task-actions">
                      {canStatus ? (
                        <select className="select" aria-label={`Status of ${t.title}`} value={t.status} disabled={busyId === t.id} onChange={(e) => setStatus(t, e.target.value as TaskStatus)}>
                          {STATUSES.map((s) => <option key={s} value={s}>{taskStatusLabel(s)}</option>)}
                        </select>
                      ) : (
                        <span className="pill chip">{taskStatusLabel(t.status)}</span>
                      )}
                      {manage && (
                        <>
                          <button type="button" className="icon-x" aria-label={`Edit ${t.title}`} title="Edit" onClick={() => setDialog({ task: t })}><Pencil size={16} /></button>
                          <button type="button" className="icon-x" aria-label={`Delete ${t.title}`} title="Delete" onClick={() => setDeleting(t)}><Trash2 size={16} /></button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {manage && (
        <div className="card-actions">
          <button type="button" className="btn btn-primary" onClick={() => setDialog({})}><Plus size={16} />New task</button>
        </div>
      )}
      {dialog && (
        <TaskDialog
          requestId={requestId}
          assignees={assignableToTasks(members)}
          task={dialog.task}
          onClose={() => setDialog(null)}
          onConflict={onChanged}
          onSaved={(kind) => {
            setDialog(null);
            notify("success", kind === "created" ? "The task was created and assigned." : "The task was updated.");
            onChanged();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete task"
          message={`Delete "${deleting.title}"? This cannot be undone. The deletion is kept in the history.`}
          confirmLabel="Delete"
          busyLabel="Deleting…"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await deleteTask(requestId, deleting.id);
            } catch (e) {
              if (e instanceof ApiClientError && e.status === 409) onChanged();
              throw e;
            }
            setDeleting(null);
            notify("success", "The task was deleted.");
            onChanged();
          }}
        />
      )}
    </section>
  );
}
