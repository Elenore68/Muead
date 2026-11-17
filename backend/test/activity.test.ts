import "./helpers/env";
import { after, afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { handler as activity } from "../src/handlers/activity";
import { planNotifications } from "../src/lib/notifications";
import { sortEntries, summaryOf } from "../src/lib/activity";
import { event, expressionsOf, FakeDb, parse, reservedWordsIn, type Sent } from "./helpers/fakeDb";

const U = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), PART = U(3), OTHER = U(4), APPR = U(5), ADMIN = U(9);
const RID = "01JC0000000000000000000001";
const EID = "01JC00000000000000000000E1";
let db: FakeDb;
const allSent: Sent[] = [];
beforeEach(() => {
  db = new FakeDb().install();
});
afterEach(() => {
  allSent.push(...db.sent);
  db.uninstall();
});

const seedAll = (status = "IN_PROGRESS") => {
  db.put({ PK: `REQ#${RID}`, SK: "META", entityType: "REQUEST", id: RID, requestNo: "REQ-0001", title: "Patch DB", description: "d", status, ownerId: OWNER, createdAt: "2026-11-10T00:00:00.000Z", version: 5 });
  for (const [id, role] of [[OWNER, "OWNER"], [PART, "PARTICIPANT"], [APPR, "APPROVER"]]) {
    db.put({ PK: `REQ#${RID}`, SK: `MEMBER#${id}`, entityType: "MEMBER", requestId: RID, userId: id, displayName: `N${id.slice(-1)}`, initials: "XX", activityRole: role, status: "ACTIVE" });
  }
};
const seedIssue = (o: Record<string, unknown> = {}) =>
  db.put({ PK: `REQ#${RID}`, SK: `ACT#${EID}`, entityType: "ACTIVITY_ENTRY", id: EID, requestId: RID, type: "ISSUE", text: "Disk full", severity: "HIGH", state: "OPEN", authorId: PART, authorName: "N3", authorRole: "PARTICIPANT", createdAt: "2026-11-12T00:00:00.000Z", version: 1, ...o });

const call = (method: string, resource: string, sub: string, body?: unknown, path: Record<string, string> = {}, groups = "") =>
  activity(event({ method, resource, sub, groups, body, path: { requestId: RID, ...path } })).then(parse);
const list = (sub: string) => call("GET", "/requests/{requestId}/activity", sub);
const add = (sub: string, body: unknown, groups = "") => call("POST", "/requests/{requestId}/activity", sub, body, {}, groups);
const resolve = (sub: string, body: unknown, id = EID) => call("PATCH", "/requests/{requestId}/activity/{entryId}", sub, body, { entryId: id });
const ops = (tx: any[]) => tx.map((t) => Object.values(t)[0] as any);
const audit = (tx: any[]) => ops(tx).find((o) => String(o.Item?.SK).startsWith("AUDIT#")).Item;

describe("POST /requests/{id}/activity", () => {
  test("a participant adds a note: one transaction with an execution-stage check and an audit entry that does not copy the text", async () => {
    seedAll();
    const res = await add(PART, { type: "NOTE", text: " Started the patch " });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual([res.body.type, res.body.text, res.body.state, res.body.severity, res.body.author.id], ["NOTE", "Started the patch", null, null, PART]);
    const [tx] = db.transactions();
    const o = ops(tx);
    assert.match(o[0].Item.SK, /^ACT#/);
    assert.ok(o.some((x) => x.Key?.SK === "META" && /#s IN \(:e0, :e1\)/.test(x.ConditionExpression)));
    const a = audit(tx);
    assert.equal(a.action, "ACTIVITY_NOTE_ADDED");
    assert.ok(!JSON.stringify(a).includes("Started the patch"));
  });

  test("an issue needs a severity and starts OPEN", async () => {
    seedAll();
    assert.equal((await add(OWNER, { type: "ISSUE", text: "Disk full" })).status, 400);
    assert.equal((await add(OWNER, { type: "ISSUE", text: "Disk full", severity: "URGENT" })).status, 400);
    const res = await add(OWNER, { type: "ISSUE", text: "Disk full", severity: "HIGH" });
    assert.equal(res.status, 201);
    assert.deepEqual([res.body.state, res.body.severity], ["OPEN", "HIGH"]);
    assert.deepEqual([audit(db.transactions()[0]).action, audit(db.transactions()[0]).severity], ["ISSUE_REPORTED", "HIGH"]);
  });

  test("validation: type, text, notes have no severity", async () => {
    seedAll();
    assert.equal((await add(OWNER, { type: "TODO", text: "x" })).status, 400);
    assert.equal((await add(OWNER, { type: "NOTE" })).status, 400);
    assert.equal((await add(OWNER, { type: "NOTE", text: "x".repeat(2001) })).status, 400);
    assert.equal((await add(OWNER, { type: "NOTE", text: "x", severity: "LOW" })).status, 400);
    assert.equal(db.transactions().length, 0);
  });

  test("approvers 403, strangers 404, admin allowed", async () => {
    seedAll();
    assert.equal((await add(APPR, { type: "NOTE", text: "x" })).status, 403);
    assert.equal((await add(OTHER, { type: "NOTE", text: "x" })).status, 404);
    assert.equal((await add(ADMIN, { type: "NOTE", text: "x" }, "PlatformAdmin")).status, 201);
  });

  test("only while In Progress or in Validation", async () => {
    for (const status of ["DRAFT", "APPROVED", "SCHEDULED", "READINESS", "COMPLETED", "CANCELLED"]) {
      seedAll(status);
      assert.equal((await add(OWNER, { type: "NOTE", text: "x" })).body.error.code, "INVALID_STATE", status);
    }
    seedAll("VALIDATION");
    assert.equal((await add(OWNER, { type: "NOTE", text: "x" })).status, 201);
  });

  test("entry limit and concurrent change", async () => {
    seedAll();
    db.failNextTransactions = 1;
    assert.equal((await add(OWNER, { type: "NOTE", text: "x" })).body.error.code, "CONCURRENT_UPDATE");
    for (let i = 0; i < 500; i++) db.put({ PK: `REQ#${RID}`, SK: `ACT#01JC0000000000000000${String(i).padStart(6, "0")}`, type: "NOTE" });
    assert.equal((await add(OWNER, { type: "NOTE", text: "x" })).body.error.code, "ENTRY_LIMIT");
  });
});

describe("GET /requests/{id}/activity", () => {
  test("newest first with a summary; all members read, strangers get 404", async () => {
    seedAll();
    seedIssue();
    db.put({ PK: `REQ#${RID}`, SK: "ACT#01JC00000000000000000000E2", id: "01JC00000000000000000000E2", type: "NOTE", text: "later", createdAt: "2026-11-13T00:00:00.000Z", authorId: OWNER, authorName: "O", authorRole: "OWNER", version: 1 });
    db.put({ PK: `REQ#${RID}`, SK: "ACT#01JC00000000000000000000E3", id: "01JC00000000000000000000E3", type: "ISSUE", severity: "LOW", state: "RESOLVED", text: "old", createdAt: "2026-11-11T00:00:00.000Z", authorId: OWNER, authorName: "O", authorRole: "OWNER", version: 2 });
    const res = await list(APPR);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.items.map((e: any) => e.id.slice(-2)), ["E2", "E1", "E3"]);
    assert.deepEqual(res.body.summary, { notes: 1, issues: 2, openIssues: 1, openHigh: 1 });
    assert.equal((await list(OTHER)).status, 404);
  });

  test("helpers", () => {
    assert.deepEqual(summaryOf([]), { notes: 0, issues: 0, openIssues: 0, openHigh: 0 });
    assert.deepEqual(sortEntries([{ createdAt: "a", id: "1" }, { createdAt: "b", id: "2" }]).map((e) => e.id), ["2", "1"]);
  });
});

describe("PATCH /requests/{id}/activity/{entryId}", () => {
  test("resolve needs a note, records who and when, and writes ISSUE_RESOLVED with the reporter", async () => {
    seedAll();
    seedIssue();
    assert.equal((await resolve(PART, { version: 1, state: "RESOLVED" })).status, 400);
    const res = await resolve(PART, { version: 1, state: "RESOLVED", note: " Cleared logs " });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body.state, res.body.resolutionNote, res.body.resolvedBy.id, res.body.version], ["RESOLVED", "Cleared logs", PART, 2]);
    assert.ok(res.body.resolvedAt);
    const a = audit(db.transactions()[0]);
    assert.deepEqual([a.action, a.reportedBy], ["ISSUE_RESOLVED", PART]);
    assert.match(ops(db.transactions()[0])[0].ConditionExpression, /#v = :v/);
  });

  test("reopening clears the resolution", async () => {
    seedAll();
    seedIssue({ state: "RESOLVED", resolutionNote: "done", resolvedBy: PART, resolvedByName: "N3", resolvedAt: "2026-11-13T00:00:00.000Z", version: 2 });
    const res = await resolve(OWNER, { version: 2, state: "OPEN" });
    assert.equal(res.status, 200);
    assert.deepEqual([res.body.state, res.body.resolutionNote, res.body.resolvedBy, res.body.resolvedAt], ["OPEN", null, null, null]);
    assert.equal(audit(db.transactions()[0]).action, "ISSUE_REOPENED");
  });

  test("notes cannot be resolved; approvers 403; same state 409; stale version 409; unknown 404", async () => {
    seedAll();
    seedIssue();
    db.put({ PK: `REQ#${RID}`, SK: "ACT#01JC00000000000000000000N1", id: "01JC00000000000000000000N1", type: "NOTE", text: "n", version: 1 });
    assert.equal((await resolve(OWNER, { version: 1, state: "RESOLVED", note: "x" }, "01JC00000000000000000000N1")).body.error.code, "NOT_AN_ISSUE");
    assert.equal((await resolve(APPR, { version: 1, state: "RESOLVED", note: "x" })).status, 403);
    assert.equal((await resolve(OWNER, { version: 1, state: "OPEN" })).body.error.code, "ALREADY_IN_STATE");
    assert.equal((await resolve(OWNER, { version: 7, state: "RESOLVED", note: "x" })).body.error.code, "VERSION_CONFLICT");
    assert.equal((await resolve(OWNER, { version: 1, state: "RESOLVED", note: "x" }, "01JC00000000000000000000ZZ")).status, 404);
    assert.equal((await resolve(OWNER, { version: 1, state: "NOPE" })).status, 400);
  });

  test("not outside the execution stages", async () => {
    seedAll("COMPLETED");
    seedIssue();
    assert.equal((await resolve(OWNER, { version: 1, state: "RESOLVED", note: "x" })).body.error.code, "INVALID_STATE");
  });
});

describe("notifications", () => {
  const req = { id: RID, requestNo: "REQ-0001", title: "Patch DB", ownerId: OWNER };
  const mem = [
    { userId: OWNER, activityRole: "OWNER", status: "ACTIVE" },
    { userId: PART, activityRole: "PARTICIPANT", status: "ACTIVE" },
    { userId: APPR, activityRole: "APPROVER", status: "ACTIVE" },
  ] as const;
  const who = (action: string, actorId: string, extra: Record<string, unknown> = {}) =>
    planNotifications({ action, actorId, actorName: "A", ...extra }, req, [...mem]).map((p) => `${p.recipientId.slice(-1)}:${p.type}`);
  test("issues reach the owner and participants (not approvers, not the reporter); resolutions reach the owner and reporter; notes nobody", () => {
    assert.deepEqual(who("ISSUE_REPORTED", PART, { severity: "HIGH" }), ["1:ISSUE_REPORTED"]);
    assert.deepEqual(who("ISSUE_REPORTED", OWNER), ["3:ISSUE_REPORTED"]);
    assert.deepEqual(who("ISSUE_RESOLVED", OWNER, { reportedBy: PART }), ["3:ISSUE_RESOLVED"]);
    assert.deepEqual(who("ISSUE_RESOLVED", PART, { reportedBy: PART }), ["1:ISSUE_RESOLVED"]);
    for (const a of ["ACTIVITY_NOTE_ADDED", "ISSUE_REOPENED"]) assert.deepEqual(who(a, OWNER), [], a);
  });
});

after(() => {
  const offenders = allSent.flatMap((s) => expressionsOf(s.input).map((e) => ({ cmd: s.name, e, bad: reservedWordsIn(e) }))).filter((x) => x.bad.length);
  assert.deepEqual(offenders, [], "no DynamoDB reserved word may appear un-aliased");
});
