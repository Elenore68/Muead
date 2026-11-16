import "./helpers/env";
import { after, afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { handler as tasks } from "../src/handlers/tasks";
import { handler as members } from "../src/handlers/members";
import { planNotifications } from "../src/lib/notifications";
import { event, expressionsOf, FakeDb, parse, reservedWordsIn, type Sent } from "./helpers/fakeDb";

const U = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SARA = U(2), PART = U(3), OTHER = U(4), APPR = U(5), ADMIN = U(9);
const RID = "01JC0000000000000000000001";
const TID = "01JC00000000000000000000T1";
let db: FakeDb;
const allSent: Sent[] = [];
beforeEach(() => {
  db = new FakeDb().install();
});
afterEach(() => {
  allSent.push(...db.sent);
  db.uninstall();
});

const seedRequest = (o: Record<string, unknown> = {}) =>
  db.put({
    PK: `REQ#${RID}`, SK: "META", entityType: "REQUEST", id: RID, requestNo: "REQ-0001", title: "Patch DB", description: "d", status: "APPROVED",
    ownerId: OWNER, ownerName: "Owner", ownerInitials: "Ow", createdAt: "2026-11-10T00:00:00.000Z", updatedAt: "2026-11-10T00:00:00.000Z", version: 3, ...o,
  });
const seedMember = (userId: string, activityRole: string, extra: Record<string, unknown> = {}) =>
  db.put({ PK: `REQ#${RID}`, SK: `MEMBER#${userId}`, entityType: "MEMBER", requestId: RID, userId, displayName: `Name${userId.slice(-1)}`, initials: "XX", activityRole, status: "ACTIVE", ...extra });
const seedTask = (o: Record<string, unknown> = {}) =>
  db.put({
    PK: `REQ#${RID}`, SK: `TASK#${TID}`, entityType: "TASK", id: TID, requestId: RID, title: "Backup", assigneeId: PART, assigneeName: "Name3", assigneeInitials: "XX",
    status: "TODO", createdBy: OWNER, createdByName: "Owner", createdAt: "2026-11-11T00:00:00.000Z", updatedAt: "2026-11-11T00:00:00.000Z", version: 1, ...o,
  });
const seedAll = () => {
  seedRequest();
  seedMember(OWNER, "OWNER");
  seedMember(PART, "PARTICIPANT");
  seedMember(APPR, "APPROVER");
};

const call = (h: any, method: string, resource: string, sub: string, body?: unknown, path: Record<string, string> = {}, groups = "") =>
  h(event({ method, resource, sub, groups, body, path: { requestId: RID, ...path } })).then(parse);
const list = (sub: string) => call(tasks, "GET", "/requests/{requestId}/tasks", sub);
const create = (sub: string, body: unknown, groups = "") => call(tasks, "POST", "/requests/{requestId}/tasks", sub, body, {}, groups);
const patch = (sub: string, body: unknown, id = TID) => call(tasks, "PATCH", "/requests/{requestId}/tasks/{taskId}", sub, body, { taskId: id });
const del = (sub: string, id = TID) => call(tasks, "DELETE", "/requests/{requestId}/tasks/{taskId}", sub, undefined, { taskId: id });
const ops = (tx: any[]) => tx.map((t) => Object.values(t)[0] as any);
const auditActions = (tx: any[]) => ops(tx).filter((o) => String(o.Item?.SK).startsWith("AUDIT#")).map((o) => o.Item.action);

describe("tasks: create", () => {
  test("owner creates a task for a participant in one transaction with checks and a TASK_ASSIGNED audit", async () => {
    seedAll();
    const res = await create(OWNER, { title: " Take backup ", description: "Full", assigneeId: PART, dueDate: "2026-12-01" });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual([res.body.title, res.body.status, res.body.assignee.id, res.body.dueDate, res.body.version], ["Take backup", "TODO", PART, "2026-12-01", 1]);
    const [tx] = db.transactions();
    const o = ops(tx);
    assert.match(o[0].Item.SK, /^TASK#/);
    assert.ok(o.some((x) => x.Key?.SK === "META" && /NOT \(#s IN/.test(x.ConditionExpression)), "request-open check");
    assert.ok(o.some((x) => x.Key?.SK === `MEMBER#${PART}` && /participation/.test(JSON.stringify(x.ExpressionAttributeNames))), "assignee check");
    const audit = o.find((x) => String(x.Item?.SK).startsWith("AUDIT#")).Item;
    assert.deepEqual([audit.action, audit.assigneeId, audit.taskTitle, audit.assignedBy], ["TASK_ASSIGNED", PART, "Take backup", OWNER]);
  });

  test("the owner can take a task; approvers, strangers and removed or declined people cannot be assigned", async () => {
    seedAll();
    assert.equal((await create(OWNER, { title: "t", assigneeId: OWNER })).status, 201);
    assert.equal((await create(OWNER, { title: "t", assigneeId: APPR })).body.error.code, "ASSIGNEE_IS_APPROVER");
    assert.equal((await create(OWNER, { title: "t", assigneeId: OTHER })).body.error.code, "ASSIGNEE_NOT_MEMBER");
    seedMember(SARA, "PARTICIPANT", { status: "REMOVED" });
    assert.equal((await create(OWNER, { title: "t", assigneeId: SARA })).body.error.code, "ASSIGNEE_NOT_MEMBER");
    seedMember(U(6), "PARTICIPANT", { participation: "DECLINED" });
    assert.equal((await create(OWNER, { title: "t", assigneeId: U(6) })).body.error.code, "PARTICIPATION_DECLINED");
    seedMember(U(7), "PARTICIPANT", { participation: "CONFIRMED" });
    assert.equal((await create(OWNER, { title: "t", assigneeId: U(7) })).status, 201);
  });

  test("participant 403, stranger 404, admin allowed", async () => {
    seedAll();
    assert.equal((await create(PART, { title: "t", assigneeId: PART })).status, 403);
    assert.equal((await create(OTHER, { title: "t", assigneeId: PART })).status, 404);
    assert.equal((await create(ADMIN, { title: "t", assigneeId: PART }, "PlatformAdmin")).status, 201);
  });

  test("validation: title, assignee, date format and limits", async () => {
    seedAll();
    assert.equal((await create(OWNER, { assigneeId: PART })).status, 400);
    assert.equal((await create(OWNER, { title: "t" })).status, 400);
    assert.equal((await create(OWNER, { title: "t", assigneeId: "nope" })).status, 400);
    assert.equal((await create(OWNER, { title: "x".repeat(201), assigneeId: PART })).status, 400);
    for (const dueDate of ["12/01/2026", "2026-02-30", "tomorrow"]) assert.equal((await create(OWNER, { title: "t", assigneeId: PART, dueDate })).status, 400, dueDate);
    assert.equal(db.transactions().length, 0);
  });

  test("no tasks on a completed or cancelled request; at most 100 tasks", async () => {
    for (const status of ["COMPLETED", "CANCELLED"]) {
      seedRequest({ status });
      seedMember(OWNER, "OWNER");
      seedMember(PART, "PARTICIPANT");
      assert.equal((await create(OWNER, { title: "t", assigneeId: PART })).body.error.code, "INVALID_STATE", status);
    }
    seedAll();
    for (let i = 0; i < 100; i++) db.put({ PK: `REQ#${RID}`, SK: `TASK#01JC0000000000000000${String(i).padStart(6, "0")}`, status: "TODO" });
    assert.equal((await create(OWNER, { title: "t", assigneeId: PART })).body.error.code, "TASK_LIMIT");
  });

  test("a concurrent change fails the transaction with 409", async () => {
    seedAll();
    db.failNextTransactions = 1;
    const res = await create(OWNER, { title: "t", assigneeId: PART });
    assert.deepEqual([res.status, res.body.error.code], [409, "CONCURRENT_UPDATE"]);
  });
});

describe("tasks: list", () => {
  test("members see tasks with progress; strangers get 404", async () => {
    seedAll();
    seedTask();
    seedTask({ SK: "TASK#01JC00000000000000000000T2", id: "01JC00000000000000000000T2", status: "DONE", dueDate: "2020-01-01" });
    seedTask({ SK: "TASK#01JC00000000000000000000T3", id: "01JC00000000000000000000T3", dueDate: "2020-01-01" });
    const res = await list(APPR);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.progress, { total: 3, done: 1, inProgress: 0, percent: 33 });
    const byId = Object.fromEntries(res.body.items.map((t: any) => [t.id.slice(-1), t]));
    assert.equal(byId["2"].overdue, false, "done tasks are never overdue");
    assert.equal(byId["3"].overdue, true);
    assert.equal((await list(OTHER)).status, 404);
  });
});

describe("tasks: update", () => {
  test("the assignee changes only the status of their own task; DONE writes TASK_COMPLETED and stamps completion", async () => {
    seedAll();
    seedTask();
    const res = await patch(PART, { version: 1, status: "DONE" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body.status, res.body.version], ["DONE", 2]);
    assert.ok(res.body.completedAt);
    const [tx] = db.transactions();
    assert.deepEqual(auditActions(tx), ["TASK_COMPLETED"]);
    const audit = ops(tx).find((o) => String(o.Item?.SK).startsWith("AUDIT#")).Item;
    assert.deepEqual([audit.assignedBy, audit.taskTitle], [OWNER, "Backup"]);
    const put = ops(tx)[0];
    assert.match(put.ConditionExpression, /#v = :v/);
    assert.equal(put.ExpressionAttributeValues[":v"], 1);
  });

  test("assignee cannot edit other fields, reassign or touch someone else's task", async () => {
    seedAll();
    seedTask();
    assert.equal((await patch(PART, { version: 1, title: "x" })).status, 403);
    assert.equal((await patch(PART, { version: 1, assigneeId: OWNER })).status, 403);
    seedMember(SARA, "PARTICIPANT");
    assert.equal((await patch(SARA, { version: 1, status: "DONE" })).status, 403);
    assert.equal((await patch(APPR, { version: 1, status: "DONE" })).status, 403);
    assert.equal((await patch(OTHER, { version: 1, status: "DONE" })).status, 404);
  });

  test("owner edits fields, clears values and reopens a finished task", async () => {
    seedAll();
    seedTask({ status: "DONE", completedAt: "2026-11-12T00:00:00.000Z", completedBy: PART, dueDate: "2026-12-01", description: "d" });
    const res = await patch(OWNER, { version: 1, title: "New", description: null, dueDate: null, status: "IN_PROGRESS" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body.title, res.body.description, res.body.dueDate, res.body.status, res.body.completedAt], ["New", null, null, "IN_PROGRESS", null]);
    const [tx] = db.transactions();
    assert.deepEqual(auditActions(tx), ["TASK_UPDATED"]);
    assert.equal("completedAt" in ops(tx)[0].Item, false);
  });

  test("reassigning checks the new assignee and notifies them", async () => {
    seedAll();
    seedTask();
    seedMember(SARA, "PARTICIPANT", { participation: "CONFIRMED" });
    const res = await patch(OWNER, { version: 1, assigneeId: SARA });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.assignee.id, SARA);
    const [tx] = db.transactions();
    assert.deepEqual(auditActions(tx), ["TASK_ASSIGNED"]);
    assert.ok(ops(tx).some((o) => o.Key?.SK === `MEMBER#${SARA}`), "new assignee is re-checked inside the transaction");
    assert.equal((await patch(OWNER, { version: 1, assigneeId: APPR })).body.error.code, "ASSIGNEE_IS_APPROVER");
    assert.equal((await patch(OWNER, { version: 1, assigneeId: OTHER })).body.error.code, "ASSIGNEE_NOT_MEMBER");
  });

  test("stale version 409, unknown task 404, empty patch 400, finished request 409", async () => {
    seedAll();
    seedTask({ version: 4 });
    assert.equal((await patch(OWNER, { version: 1, title: "x" })).body.error.code, "VERSION_CONFLICT");
    assert.equal((await patch(OWNER, { version: 1, title: "x" }, "01JC00000000000000000000ZZ")).status, 404);
    assert.equal((await patch(OWNER, { version: 4 })).status, 400);
    assert.equal((await patch(OWNER, { version: 4, status: "NOPE" })).status, 400);
    seedRequest({ status: "COMPLETED" });
    assert.equal((await patch(OWNER, { version: 4, title: "x" })).body.error.code, "INVALID_STATE");
  });
});

describe("tasks: delete", () => {
  test("owner deletes with a TASK_DELETED audit; participants cannot", async () => {
    seedAll();
    seedTask();
    assert.equal((await del(PART)).status, 403);
    const res = await del(OWNER);
    assert.equal(res.status, 204);
    const [tx] = db.transactions();
    assert.ok(ops(tx)[0].Key.SK.startsWith("TASK#"));
    assert.deepEqual(auditActions(tx), ["TASK_DELETED"]);
    assert.equal((await del(OWNER, "01JC00000000000000000000ZZ")).status, 404);
  });
});

describe("participation", () => {
  const respond = (sub: string, body: unknown) => call(members, "POST", "/requests/{requestId}/participation", sub, body);
  const editMember = (sub: string, userId: string, body: unknown) => call(members, "PATCH", "/requests/{requestId}/members/{userId}", sub, body, { userId });

  test("a participant confirms: only their own member item is updated, with an audit entry", async () => {
    seedAll();
    const res = await respond(PART, { response: "CONFIRMED" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.participation, "CONFIRMED");
    const [tx] = db.transactions();
    const upd = ops(tx)[0];
    assert.equal(upd.Key.SK, `MEMBER#${PART}`);
    assert.match(upd.UpdateExpression, /REMOVE participationNote/);
    assert.deepEqual(auditActions(tx), ["PARTICIPATION_CONFIRMED"]);
  });

  test("declining with a note; a declined person can confirm again", async () => {
    seedAll();
    const res = await respond(PART, { response: "DECLINED", note: "On leave" });
    assert.equal(res.status, 200);
    assert.equal(res.body.participationNote, "On leave");
    assert.deepEqual(auditActions(db.transactions()[0]), ["PARTICIPATION_DECLINED"]);
    seedMember(PART, "PARTICIPANT", { participation: "DECLINED" });
    assert.equal((await respond(PART, { response: "CONFIRMED" })).status, 200);
  });

  test("owner, approver, strangers and removed members cannot answer; bad input is 400", async () => {
    seedAll();
    assert.equal((await respond(OWNER, { response: "CONFIRMED" })).body.error.code, "NOT_A_PARTICIPANT");
    assert.equal((await respond(APPR, { response: "CONFIRMED" })).body.error.code, "NOT_A_PARTICIPANT");
    assert.equal((await respond(OTHER, { response: "CONFIRMED" })).status, 404);
    seedMember(SARA, "PARTICIPANT", { status: "REMOVED" });
    assert.equal((await respond(SARA, { response: "CONFIRMED" })).status, 404);
    assert.equal((await respond(PART, { response: "MAYBE" })).status, 400);
    assert.equal((await respond(PART, { response: "DECLINED", note: "x".repeat(501) })).status, 400);
    assert.equal(db.transactions().length, 0);
  });

  test("not after the request is finished", async () => {
    seedAll();
    seedRequest({ status: "CANCELLED" });
    assert.equal((await respond(PART, { response: "CONFIRMED" })).body.error.code, "INVALID_STATE");
  });

  test("members list shows PENDING for participants (and none for others)", async () => {
    seedAll();
    seedMember(SARA, "PARTICIPANT", { participation: "CONFIRMED" });
    const res = await call(members, "GET", "/requests/{requestId}/members", OWNER);
    const by = Object.fromEntries(res.body.items.map((m: any) => [m.userId, m.participation]));
    assert.deepEqual(by, { [OWNER]: null, [APPR]: null, [PART]: "PENDING", [SARA]: "CONFIRMED" });
  });

  test("owner edits specialty and responsibilities; others cannot; the owner row is protected", async () => {
    seedAll();
    const res = await editMember(OWNER, PART, { specialty: "Database", responsibilities: " Backups " });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body.specialty, res.body.responsibilities], ["Database", "Backups"]);
    const upd = ops(db.transactions()[0])[0];
    assert.match(upd.UpdateExpression, /^SET specialty = :specialty, responsibilities = :responsibilities$/);
    assert.deepEqual(auditActions(db.transactions()[0]), ["MEMBER_UPDATED"]);
    const cleared = await editMember(OWNER, PART, { specialty: null });
    assert.equal(cleared.body.specialty, null);
    assert.match(ops(db.transactions()[1])[0].UpdateExpression, /^REMOVE specialty$/);
    assert.equal((await editMember(PART, PART, { specialty: "OS" })).status, 403);
    assert.equal((await editMember(OWNER, OWNER, { specialty: "OS" })).body.error.code, "CANNOT_EDIT_OWNER");
    assert.equal((await editMember(OWNER, PART, { specialty: "Plumbing" })).status, 400);
    assert.equal((await editMember(OWNER, PART, {})).status, 400);
    assert.equal((await editMember(OWNER, OTHER, { specialty: "OS" })).status, 404);
  });
});

describe("notifications for tasks and participation", () => {
  const request = { id: RID, requestNo: "REQ-0001", title: "Patch DB", ownerId: OWNER };
  const mem = [
    { userId: OWNER, activityRole: "OWNER", status: "ACTIVE" },
    { userId: PART, activityRole: "PARTICIPANT", status: "ACTIVE" },
    { userId: SARA, activityRole: "PARTICIPANT", status: "ACTIVE" },
  ] as const;
  const who = (action: string, actorId: string, extra: Record<string, unknown> = {}) =>
    planNotifications({ action, actorId, actorName: "Actor", ...extra }, request, [...mem]).map((p) => `${p.recipientId.slice(-1)}:${p.type}`);

  test("task assigned goes to the assignee only (never to the actor)", () => {
    assert.deepEqual(who("TASK_ASSIGNED", OWNER, { assigneeId: PART, taskTitle: "Backup" }), ["3:TASK_ASSIGNED"]);
    assert.deepEqual(who("TASK_ASSIGNED", OWNER, { assigneeId: OWNER, taskTitle: "Backup" }), []);
  });
  test("task completed goes to the owner and the person who created the task, not the one who completed it", () => {
    assert.deepEqual(who("TASK_COMPLETED", PART, { assignedBy: OWNER, taskTitle: "Backup" }), ["1:TASK_COMPLETED"]);
    assert.deepEqual(who("TASK_COMPLETED", PART, { assignedBy: SARA, taskTitle: "Backup" }), ["1:TASK_COMPLETED", "2:TASK_COMPLETED"]);
  });
  test("participation answers notify the owner; edits and deletions notify nobody", () => {
    assert.deepEqual(who("PARTICIPATION_CONFIRMED", PART), ["1:PARTICIPATION_RESPONDED"]);
    assert.deepEqual(who("PARTICIPATION_DECLINED", PART), ["1:PARTICIPATION_RESPONDED"]);
    for (const a of ["TASK_UPDATED", "TASK_DELETED", "MEMBER_UPDATED"]) assert.deepEqual(who(a, OWNER), [], a);
  });
});

after(() => {
  const offenders = allSent.flatMap((s) => expressionsOf(s.input).map((e) => ({ cmd: s.name, e, bad: reservedWordsIn(e) }))).filter((x) => x.bad.length);
  assert.deepEqual(offenders, [], "no DynamoDB reserved word may appear un-aliased");
});
