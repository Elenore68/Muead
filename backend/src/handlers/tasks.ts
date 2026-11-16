import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { auditItem } from "../lib/audit";
import { ddb, queryAll, TABLE, transact, txConditionFailed, type Item, type TransactItem } from "../lib/db";
import { conflict, notFound } from "../lib/errors";
import { json, router, type Ctx } from "../lib/http";
import { assertView, getMember, memberKey } from "../lib/members";
import { loadRequest, reqKey, type Status } from "../lib/requests";
import {
  buildTask,
  isTaskId,
  parseTaskCreate,
  parseTaskPatch,
  progressOf,
  requestOpenCheck,
  taskKey,
  toTaskApi,
  validateTaskCreate,
  validateTaskDelete,
  validateTaskUpdate,
} from "../lib/tasks";

/*
 * TASK 07: tasks of one request (SOW 4.3, 4.4).
 * Every write is one transaction: the task, an audit entry (which feeds notifications), and condition checks that
 * the request is still open and the assignee is still an active member who has not declined.
 */
const CONSISTENT = { consistent: true } as const;
const CHANGED = "The task, the request or its members changed at the same time. Reload and try again.";

const listTasks = (requestId: string, consistent = false): Promise<Item[]> =>
  queryAll({
    KeyConditionExpression: "PK = :p AND begins_with(SK, :t)",
    ExpressionAttributeValues: { ":p": `REQ#${requestId}`, ":t": "TASK#" },
    ConsistentRead: consistent,
  });

const loadTask = async (requestId: string, taskId: string, consistent = false): Promise<Item | undefined> => {
  if (!isTaskId(taskId)) throw notFound("Task not found");
  return (await ddb.send(new GetCommand({ TableName: TABLE, Key: taskKey(requestId, taskId), ConsistentRead: consistent }))).Item;
};

/** Fails the transaction if the assignee left the request or declined since we looked. */
const assigneeCheck = (requestId: string, userId: string): TransactItem => ({
  ConditionCheck: {
    TableName: TABLE,
    Key: memberKey(requestId, userId),
    ConditionExpression: "attribute_exists(PK) AND #st = :active AND (attribute_not_exists(#p) OR #p <> :declined)",
    ExpressionAttributeNames: { "#st": "status", "#p": "participation" },
    ExpressionAttributeValues: { ":active": "ACTIVE", ":declined": "DECLINED" },
  },
});

/* ------------------------------------------------------------------ GET /requests/{id}/tasks */
const list = async ({ caller, path }: Ctx) => {
  const r = await loadRequest(path.requestId);
  await assertView(r, caller);
  const tasks = await listTasks(r.id);
  return json(200, { items: tasks.map((t) => toTaskApi(t)), progress: progressOf(tasks) });
};

/* ------------------------------------------------------------------ POST /requests/{id}/tasks */
const create = async ({ caller, path, body }: Ctx) => {
  const input = parseTaskCreate(body);
  const r = await loadRequest(path.requestId, CONSISTENT);
  const access = await assertView(r, caller, CONSISTENT);
  const [assignee, existing] = await Promise.all([getMember(r.id, input.assigneeId, CONSISTENT), listTasks(r.id, true)]);
  validateTaskCreate({ access, requestStatus: r.status as Status, assignee, existingTasks: existing.length });

  const now = new Date().toISOString();
  const task = buildTask({ requestId: r.id, input, assignee: assignee!, actor: caller, now });
  const actor = { userId: caller.userId, displayName: caller.displayName, activityRole: access.auditRole };
  try {
    await transact([
      { Put: { TableName: TABLE, Item: task, ConditionExpression: "attribute_not_exists(PK)" } },
      requestOpenCheck(r.id),
      assigneeCheck(r.id, input.assigneeId),
      {
        Put: {
          TableName: TABLE,
          Item: auditItem(r.id, actor, "TASK_ASSIGNED", {
            taskId: task.id,
            taskTitle: task.title,
            assigneeId: task.assigneeId,
            assigneeName: task.assigneeName,
            assignedBy: caller.userId,
          }),
        },
      },
    ]);
  } catch (e) {
    if (txConditionFailed(e)) throw conflict("CONCURRENT_UPDATE", CHANGED);
    throw e;
  }
  return json(201, toTaskApi(task), { Location: `/v1/requests/${r.id}/tasks/${task.id}` });
};

/* ------------------------------------------------------------------ PATCH /requests/{id}/tasks/{taskId} */
const update = async ({ caller, path, body }: Ctx) => {
  const patch = parseTaskPatch(body);
  const r = await loadRequest(path.requestId, CONSISTENT);
  const access = await assertView(r, caller, CONSISTENT);
  const task = await loadTask(r.id, path.taskId, true);
  const reassigning = !!patch.assigneeId && patch.assigneeId !== task?.assigneeId;
  const newAssignee = reassigning ? await getMember(r.id, patch.assigneeId!, CONSISTENT) : undefined;
  validateTaskUpdate({ callerId: caller.userId, access, requestStatus: r.status as Status, task, patch, newAssignee });
  if (patch.version !== task!.version) throw conflict("VERSION_CONFLICT", "The task was changed by someone else. Reload and try again.");

  const now = new Date().toISOString();
  const becameDone = patch.status === "DONE" && task!.status !== "DONE";
  const changes: Item = {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...("description" in patch ? { description: patch.description ?? undefined } : {}),
    ...("dueDate" in patch ? { dueDate: patch.dueDate ?? undefined } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(reassigning ? { assigneeId: newAssignee!.userId, assigneeName: newAssignee!.displayName, assigneeInitials: newAssignee!.initials } : {}),
    ...(becameDone ? { completedAt: now, completedBy: caller.userId } : {}),
    ...(patch.status !== undefined && patch.status !== "DONE" ? { completedAt: undefined, completedBy: undefined } : {}),
  };
  const next: Item = { ...task, ...changes, updatedAt: now, version: task!.version + 1 };
  for (const [k, v] of Object.entries(changes)) if (v === undefined) delete next[k];

  const actor = { userId: caller.userId, displayName: caller.displayName, activityRole: access.auditRole };
  const audits: Item[] = [];
  if (reassigning) {
    audits.push(
      auditItem(r.id, actor, "TASK_ASSIGNED", { taskId: task!.id, taskTitle: next.title, assigneeId: next.assigneeId, assigneeName: next.assigneeName, assignedBy: caller.userId }),
    );
  }
  if (becameDone) {
    audits.push(auditItem(r.id, actor, "TASK_COMPLETED", { taskId: task!.id, taskTitle: next.title, assigneeId: next.assigneeId, assignedBy: task!.createdBy }));
  }
  if (audits.length === 0) {
    audits.push(auditItem(r.id, actor, "TASK_UPDATED", { taskId: task!.id, taskTitle: next.title, changedFields: Object.keys(changes).filter((k) => !k.startsWith("completed")) }));
  }

  try {
    await transact([
      {
        Put: {
          TableName: TABLE,
          Item: next,
          ConditionExpression: "attribute_exists(PK) AND #v = :v",
          ExpressionAttributeNames: { "#v": "version" },
          ExpressionAttributeValues: { ":v": task!.version },
        },
      },
      requestOpenCheck(r.id),
      ...(reassigning ? [assigneeCheck(r.id, next.assigneeId)] : []),
      ...audits.map((Item): TransactItem => ({ Put: { TableName: TABLE, Item } })),
    ]);
  } catch (e) {
    if (txConditionFailed(e)) throw conflict("CONCURRENT_UPDATE", CHANGED);
    throw e;
  }
  return json(200, toTaskApi(next));
};

/* ------------------------------------------------------------------ DELETE /requests/{id}/tasks/{taskId} */
const remove = async ({ caller, path }: Ctx) => {
  const r = await loadRequest(path.requestId, CONSISTENT);
  const access = await assertView(r, caller, CONSISTENT);
  const task = await loadTask(r.id, path.taskId, true);
  validateTaskDelete({ access, requestStatus: r.status as Status, task });
  try {
    await transact([
      {
        Delete: {
          TableName: TABLE,
          Key: taskKey(r.id, task!.id),
          ConditionExpression: "attribute_exists(PK) AND #v = :v",
          ExpressionAttributeNames: { "#v": "version" },
          ExpressionAttributeValues: { ":v": task!.version },
        },
      },
      requestOpenCheck(r.id),
      {
        Put: {
          TableName: TABLE,
          Item: auditItem(r.id, { userId: caller.userId, displayName: caller.displayName, activityRole: access.auditRole }, "TASK_DELETED", {
            taskId: task!.id,
            taskTitle: task!.title,
          }),
        },
      },
    ]);
  } catch (e) {
    if (txConditionFailed(e)) throw conflict("CONCURRENT_UPDATE", CHANGED);
    throw e;
  }
  return json(204);
};

export const handler = router({
  "GET /requests/{requestId}/tasks": list,
  "POST /requests/{requestId}/tasks": create,
  "PATCH /requests/{requestId}/tasks/{taskId}": update,
  "DELETE /requests/{requestId}/tasks/{taskId}": remove,
});
