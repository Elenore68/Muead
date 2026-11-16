import { api } from "./client";

/* TASK 07: tasks of one request (docs/backend/api-specification.md section 15). */
export type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  assignee: { id: string; displayName: string; initials: string };
  /** yyyy-mm-dd */
  dueDate: string | null;
  overdue: boolean;
  createdBy: { id: string; displayName: string };
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  version: number;
}

export interface TaskProgress {
  total: number;
  done: number;
  inProgress: number;
  percent: number;
}

export interface TaskList {
  items: Task[];
  progress: TaskProgress;
}

export interface TaskInput {
  title: string;
  description?: string;
  assigneeId: string;
  dueDate?: string;
}

/** Backend limits (lib/tasks.ts). */
export const MAX_TASK_TITLE = 200;
export const MAX_TASK_DESCRIPTION = 2000;

const enc = encodeURIComponent;
export const listTasks = (requestId: string, signal?: AbortSignal) => api<TaskList>(`requests/${enc(requestId)}/tasks`, { signal });
export const createTask = (requestId: string, input: TaskInput) => api<Task>(`requests/${enc(requestId)}/tasks`, { method: "POST", body: input });
/** Owner/admin may change every field. The assignee may send only `status`. `null` clears description / dueDate. */
export const updateTask = (
  requestId: string,
  taskId: string,
  version: number,
  patch: { title?: string; description?: string | null; assigneeId?: string; dueDate?: string | null; status?: TaskStatus },
) => api<Task>(`requests/${enc(requestId)}/tasks/${enc(taskId)}`, { method: "PATCH", body: { ...patch, version } });
export const deleteTask = (requestId: string, taskId: string) => api<void>(`requests/${enc(requestId)}/tasks/${enc(taskId)}`, { method: "DELETE" });
