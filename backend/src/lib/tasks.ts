import { ulid } from "ulid";
import { queryAll, TABLE, type Item, type TransactItem } from "./db";
import { ApiError, badRequest, forbidden, notFound } from "./errors";
import { isActive, type Access } from "./members";
import { reqKey, type Status } from "./requests";

/**
 * TASK 07: participation confirmation and tasks (SOW 4.3).
 *
 * Decisions taken for the points the SOW leaves open (also in PROJECT-HANDOVER.md 14.3):
 *  - Tasks belong to ONE request (no team-level tasks). Item: PK=REQ#<id>, SK=TASK#<ulid>.
 *  - A task is assigned to an ACTIVE OWNER or PARTICIPANT of the request. Approvers do not do the work.
 *  - Declining participation keeps the person on the request (the owner decides whether to remove them),
 *    but a person who declined cannot be given new tasks. They may confirm again later.
 *  - The owner or a platform admin creates, edits, reassigns and deletes tasks. The assignee may change the status of
 *    their own task and nothing else.
 *  - Tasks and participation answers are blocked once the request is COMPLETED or CANCELLED.
 */
export const TASK_STATUSES = ["TODO", "IN_PROGRESS", "DONE"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const PARTICIPATION_RESPONSES = ["CONFIRMED", "DECLINED"] as const;
export type ParticipationResponse = (typeof PARTICIPATION_RESPONSES)[number];

export const MAX_TASKS = 100;
export const MAX_TASK_TITLE = 200;
export const MAX_TASK_DESCRIPTION = 2000;
export const MAX_PARTICIPATION_NOTE = 500;
export const MAX_RESPONSIBILITIES = 1000;

/** No task or participation changes once the request is finished. */
export const TASKS_FROZEN: Status[] = ["COMPLETED", "CANCELLED"];

export const taskKey = (requestId: string, taskId: string) => ({ PK: `REQ#${requestId}`, SK: `TASK#${taskId}` });
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export const isTaskId = (id: string) => ULID.test(id);
const COGNITO_SUB = /^[0-9a-f-]{36}$/i;

/* ------------------------------------------------------------------ input parsing */
const text = (v: unknown, field: string, max: number, required: boolean): string | undefined => {
  if (v === undefined || v === null || v === "") {
    if (required) throw badRequest(`${field} is required`, [{ field, issue: "required" }]);
    return undefined;
  }
  if (typeof v !== "string") throw badRequest(`${field} must be a string`, [{ field, issue: "type" }]);
  const t = v.trim();
  if (!t) {
    if (required) throw badRequest(`${field} is required`, [{ field, issue: "required" }]);
    return undefined;
  }
  if (t.length > max) throw badRequest(`${field} is too long (max ${max})`, [{ field, issue: "max_length" }]);
  return t;
};

const dueDateOf = (v: unknown): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)) || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v) {
    throw badRequest("dueDate must be a date like 2026-12-31", [{ field: "dueDate", issue: "format" }]);
  }
  return v;
};

const statusOf = (v: unknown): TaskStatus | undefined => {
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !(TASK_STATUSES as readonly string[]).includes(v)) {
    throw badRequest(`status must be one of ${TASK_STATUSES.join(", ")}`, [{ field: "status", issue: "enum" }]);
  }
  return v as TaskStatus;
};

const assigneeOf = (v: unknown, required: boolean): string | undefined => {
  if (v === undefined) {
    if (required) throw badRequest("assigneeId is required", [{ field: "assigneeId", issue: "required" }]);
    return undefined;
  }
  if (typeof v !== "string" || !COGNITO_SUB.test(v)) throw badRequest("assigneeId is not a valid user id", [{ field: "assigneeId", issue: "format" }]);
  return v;
};

export interface TaskCreate {
  title: string;
  description?: string;
  assigneeId: string;
  dueDate?: string;
}

export const parseTaskCreate = (b: Record<string, unknown>): TaskCreate => {
  const due = dueDateOf(b.dueDate);
  return {
    title: text(b.title, "title", MAX_TASK_TITLE, true)!,
    description: text(b.description, "description", MAX_TASK_DESCRIPTION, false),
    assigneeId: assigneeOf(b.assigneeId, true)!,
    ...(due ? { dueDate: due } : {}),
  };
};

export interface TaskPatch {
  version: number;
  title?: string;
  /** null clears the value. */
  description?: string | null;
  assigneeId?: string;
  dueDate?: string | null;
  status?: TaskStatus;
}

export const parseTaskPatch = (b: Record<string, unknown>): TaskPatch => {
  if (typeof b.version !== "number" || !Number.isInteger(b.version)) throw badRequest("version is required", [{ field: "version", issue: "required" }]);
  const p: TaskPatch = { version: b.version };
  if ("title" in b) p.title = text(b.title, "title", MAX_TASK_TITLE, true);
  if ("description" in b) p.description = text(b.description, "description", MAX_TASK_DESCRIPTION, false) ?? null;
  if ("assigneeId" in b) p.assigneeId = assigneeOf(b.assigneeId, true);
  if ("dueDate" in b) p.dueDate = dueDateOf(b.dueDate) ?? null;
  if ("status" in b) p.status = statusOf(b.status);
  if (Object.keys(p).length === 1) throw badRequest("Nothing to update");
  return p;
};

export const parseParticipationBody = (b: Record<string, unknown>): { response: ParticipationResponse; note?: string } => {
  if (typeof b.response !== "string" || !(PARTICIPATION_RESPONSES as readonly string[]).includes(b.response)) {
    throw badRequest("response must be CONFIRMED or DECLINED", [{ field: "response", issue: "enum" }]);
  }
  return { response: b.response as ParticipationResponse, note: text(b.note, "note", MAX_PARTICIPATION_NOTE, false) };
};

/** Fields an owner may change on a member (everything else about a member is fixed). */
export const parseMemberPatch = (b: Record<string, unknown>, teams: readonly string[]): { specialty?: string | null; responsibilities?: string | null } => {
  const out: { specialty?: string | null; responsibilities?: string | null } = {};
  if ("specialty" in b) {
    if (b.specialty === null || b.specialty === "") out.specialty = null;
    else if (typeof b.specialty === "string" && teams.includes(b.specialty)) out.specialty = b.specialty;
    else throw badRequest(`specialty must be one of ${teams.join(", ")}`, [{ field: "specialty", issue: "enum" }]);
  }
  if ("responsibilities" in b) out.responsibilities = text(b.responsibilities, "responsibilities", MAX_RESPONSIBILITIES, false) ?? null;
  if (Object.keys(out).length === 0) throw badRequest("Nothing to update");
  return out;
};

/* ------------------------------------------------------------------ participation */
/** A participant who was added before this feature has no answer yet: that means PENDING. */
export const participationOf = (m: Item): "PENDING" | ParticipationResponse | null =>
  m.activityRole === "PARTICIPANT" ? (m.participation ?? "PENDING") : null;

/** Only the person themselves, only as a participant, only while the request is not finished. */
export const validateParticipation = (p: { callerId: string; targetId: string; member?: Item; requestStatus: Status }): void => {
  if (!isActive(p.member) || p.callerId !== p.targetId) throw notFound("You are not a participant of this request");
  if (p.member.activityRole !== "PARTICIPANT") {
    throw new ApiError(409, "NOT_A_PARTICIPANT", "Only participants confirm or decline participation");
  }
  if (TASKS_FROZEN.includes(p.requestStatus)) throw new ApiError(409, "INVALID_STATE", `The request is ${p.requestStatus}; participation can no longer change`);
};

/** Owner / admin edits specialty or responsibilities of an active, non-owner member. */
export const validateMemberPatch = (p: { access: Access; member?: Item; requestStatus: Status }): void => {
  if (!p.access.canManageMembers) throw forbidden("Only the owner of this request or a platform admin can edit members");
  if (!isActive(p.member)) throw notFound("Member not found");
  if (p.member.activityRole === "OWNER") throw new ApiError(400, "CANNOT_EDIT_OWNER", "The owner's role details cannot be edited");
  if (TASKS_FROZEN.includes(p.requestStatus)) throw new ApiError(409, "INVALID_STATE", `Members cannot change when the request is ${p.requestStatus}`);
};

/* ------------------------------------------------------------------ tasks */
export const buildTask = (p: { requestId: string; input: TaskCreate; assignee: Item; actor: { userId: string; displayName: string }; now: string }): Item => {
  const id = ulid();
  return {
    ...taskKey(p.requestId, id),
    entityType: "TASK",
    id,
    requestId: p.requestId,
    title: p.input.title,
    description: p.input.description,
    assigneeId: p.assignee.userId,
    assigneeName: p.assignee.displayName,
    assigneeInitials: p.assignee.initials,
    dueDate: p.input.dueDate,
    status: "TODO",
    createdBy: p.actor.userId,
    createdByName: p.actor.displayName,
    createdAt: p.now,
    updatedAt: p.now,
    version: 1,
  };
};

export const toTaskApi = (t: Item, today: string = new Date().toISOString().slice(0, 10)) => ({
  id: t.id,
  title: t.title,
  description: t.description ?? null,
  status: t.status as TaskStatus,
  assignee: { id: t.assigneeId, displayName: t.assigneeName, initials: t.assigneeInitials },
  dueDate: t.dueDate ?? null,
  overdue: !!t.dueDate && t.status !== "DONE" && t.dueDate < today,
  createdBy: { id: t.createdBy, displayName: t.createdByName },
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
  completedAt: t.completedAt ?? null,
  version: t.version,
});

export const progressOf = (tasks: Item[]) => {
  const done = tasks.filter((t) => t.status === "DONE").length;
  return { total: tasks.length, done, inProgress: tasks.filter((t) => t.status === "IN_PROGRESS").length, percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0 };
};

/** Who may be given a task: an ACTIVE owner or participant who has not declined. */
export const validateAssignee = (member: Item | undefined): void => {
  if (!isActive(member)) throw new ApiError(409, "ASSIGNEE_NOT_MEMBER", "Tasks can only be assigned to members of this request. Add the person as a participant first.");
  if (member.activityRole === "APPROVER") throw new ApiError(409, "ASSIGNEE_IS_APPROVER", "Approvers review the request; assign tasks to the owner or a participant");
  if (member.activityRole === "PARTICIPANT" && member.participation === "DECLINED") {
    throw new ApiError(409, "PARTICIPATION_DECLINED", "This participant declined. Remove them or ask them to confirm before assigning tasks.");
  }
};

export const validateTaskCreate = (p: { access: Access; requestStatus: Status; assignee: Item | undefined; existingTasks: number }): void => {
  if (!p.access.canEdit) throw forbidden("Only the owner of this request can create tasks");
  if (TASKS_FROZEN.includes(p.requestStatus)) throw new ApiError(409, "INVALID_STATE", `Tasks cannot change when the request is ${p.requestStatus}`);
  if (p.existingTasks >= MAX_TASKS) throw new ApiError(409, "TASK_LIMIT", `A request can have at most ${MAX_TASKS} tasks`);
  validateAssignee(p.assignee);
};

export interface TaskUpdateRules {
  callerId: string;
  access: Access;
  requestStatus: Status;
  task: Item | undefined;
  patch: TaskPatch;
  /** The new assignee's member item, if the patch reassigns. */
  newAssignee?: Item;
}

/** Owner/admin change anything. The assignee may change only `status` of their own task. */
export const validateTaskUpdate = (p: TaskUpdateRules): void => {
  if (!p.task) throw notFound("Task not found");
  if (TASKS_FROZEN.includes(p.requestStatus)) throw new ApiError(409, "INVALID_STATE", `Tasks cannot change when the request is ${p.requestStatus}`);
  const statusOnly = Object.keys(p.patch).every((k) => k === "version" || k === "status");
  const isAssignee = p.task.assigneeId === p.callerId && p.access.role !== undefined;
  if (!p.access.canEdit && !(isAssignee && statusOnly)) {
    throw forbidden(isAssignee ? "Assignees can only change the status of their task" : "Only the owner of this request or the assignee can change this task");
  }
  if (p.patch.assigneeId && p.patch.assigneeId !== p.task.assigneeId) validateAssignee(p.newAssignee);
};

export const validateTaskDelete = (p: { access: Access; requestStatus: Status; task: Item | undefined }): void => {
  if (!p.access.canEdit) throw forbidden("Only the owner of this request can delete tasks");
  if (!p.task) throw notFound("Task not found");
  if (TASKS_FROZEN.includes(p.requestStatus)) throw new ApiError(409, "INVALID_STATE", `Tasks cannot change when the request is ${p.requestStatus}`);
};

/** Transaction item: fails if the request was finished or archived in the meantime. */
export const requestOpenCheck = (requestId: string): TransactItem => {
  const values: Record<string, string> = {};
  TASKS_FROZEN.forEach((s, i) => (values[`:f${i}`] = s));
  return {
    ConditionCheck: {
      TableName: TABLE,
      Key: reqKey(requestId),
      ConditionExpression: `attribute_exists(PK) AND NOT (#s IN (${TASKS_FROZEN.map((_, i) => `:f${i}`).join(", ")}))`,
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: values,
    },
  };
};

export const listTasksOf = (requestId: string, consistent = false): Promise<Item[]> =>
  queryAll({
    KeyConditionExpression: "PK = :p AND begins_with(SK, :t)",
    ExpressionAttributeValues: { ":p": `REQ#${requestId}`, ":t": "TASK#" },
    ConsistentRead: consistent,
  });
