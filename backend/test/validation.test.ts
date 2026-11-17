import "./helpers/env";
import { after, afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { handler as validation } from "../src/handlers/validation";
import { handler as requests } from "../src/handlers/requests";
import { buildValidationItems, DOMAINS, validateClosure, validationProgress } from "../src/lib/validation";
import { buildReport } from "../src/lib/report";
import { planNotifications } from "../src/lib/notifications";
import { event, expressionsOf, FakeDb, parse, reservedWordsIn, type Sent } from "./helpers/fakeDb";

const U = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), PART = U(3), OTHER = U(4), APPR = U(5), ADMIN = U(9);
const RID = "01JC0000000000000000000001";
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
    PK: `REQ#${RID}`, SK: "META", entityType: "REQUEST", id: RID, requestNo: "REQ-0001", title: "Patch DB", description: "d", status: "VALIDATION",
    ownerId: OWNER, ownerName: "Owner", ownerInitials: "Ow", createdAt: "2026-11-10T00:00:00.000Z", updatedAt: "2026-11-10T00:00:00.000Z", version: 9,
    environment: "Production", cloudPlatform: "AWS", maintenanceType: "Patching", scheduleStart: "2026-12-01T00:00:00.000Z", approvalPolicy: "ALL", approvalRound: 2,
    startedAt: "2026-12-01T01:00:00.000Z", ...o,
  });
const seedAll = (result = "PENDING") => {
  seedRequest();
  for (const [id, role] of [[OWNER, "OWNER"], [PART, "PARTICIPANT"], [APPR, "APPROVER"]]) {
    db.put({ PK: `REQ#${RID}`, SK: `MEMBER#${id}`, entityType: "MEMBER", requestId: RID, userId: id, displayName: `N${id.slice(-1)}`, initials: "XX", activityRole: role, status: "ACTIVE" });
  }
  const items = buildValidationItems(RID, "2026-12-01T02:00:00.000Z").map((i) => ({ ...i, result }));
  items.forEach((i) => db.put(i));
  return items;
};
const seedIssue = (state: string) =>
  db.put({ PK: `REQ#${RID}`, SK: "ACT#01JC00000000000000000000E1", id: "01JC00000000000000000000E1", type: "ISSUE", text: "Disk full", severity: "HIGH", state, createdAt: "2026-12-01T03:00:00.000Z", authorId: PART, authorName: "N3", version: 1 });

const call = (h: any, method: string, resource: string, sub: string, body?: unknown, path: Record<string, string> = {}, groups = "") =>
  h(event({ method, resource, sub, groups, body, path: { requestId: RID, ...path } })).then(parse);
const list = (sub: string) => call(validation, "GET", "/requests/{requestId}/validation", sub);
const set = (sub: string, domain: string, body: unknown, groups = "") => call(validation, "PATCH", "/requests/{requestId}/validation/{domain}", sub, body, { domain }, groups);
const report = (sub: string) => call(validation, "GET", "/requests/{requestId}/report", sub);
const close = (sub: string, body: Record<string, unknown> = {}, version = 9) => call(requests, "POST", "/requests/{requestId}/transition", sub, { to: "COMPLETED", version, ...body });
const ops = (tx: any[]) => tx.map((t) => Object.values(t)[0] as any);

describe("validation items", () => {
  test("one item per SOW domain, all pending", () => {
    const items = buildValidationItems(RID, "2026-12-01T02:00:00.000Z");
    assert.deepEqual(items.map((i) => i.domain), ["APPLICATION", "DATABASE", "OS", "INFRASTRUCTURE"]);
    assert.ok(items.every((i) => i.result === "PENDING" && i.SK === `VALID#${i.domain}`));
    assert.deepEqual([...DOMAINS], ["APPLICATION", "DATABASE", "OS", "INFRASTRUCTURE"]);
  });

  test("Validation is entered with the four checks created in the same transaction", async () => {
    seedRequest({ status: "IN_PROGRESS" });
    db.put({ PK: `REQ#${RID}`, SK: `MEMBER#${OWNER}`, entityType: "MEMBER", requestId: RID, userId: OWNER, displayName: "O", initials: "O", activityRole: "OWNER", status: "ACTIVE" });
    const res = await call(requests, "POST", "/requests/{requestId}/transition", OWNER, { to: "VALIDATION", version: 9 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const created = ops(db.transactions()[0]).filter((o) => String(o.Item?.SK).startsWith("VALID#"));
    assert.equal(created.length, 4);
  });
});

describe("GET /requests/{id}/validation", () => {
  test("members read results with progress; strangers get 404; before the stage nothing is started", async () => {
    const items = seedAll();
    db.put({ ...items[0], result: "PASSED" });
    db.put({ ...items[1], result: "FAILED", note: "x" });
    const res = await list(APPR);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.progress, { total: 4, resolved: 2, passed: 1, failed: 1, percent: 50 });
    assert.equal((await list(OTHER)).status, 404);
    seedRequest({ status: "IN_PROGRESS" });
    db.store.forEach((_, k) => k.includes("VALID#") && db.store.delete(k));
    assert.deepEqual([(await list(OWNER)).body.started, (await list(OWNER)).body.items], [false, []]);
  });
});

describe("PATCH /requests/{id}/validation/{domain}", () => {
  test("a participant records a pass; the audit says which domain", async () => {
    seedAll();
    const res = await set(PART, "APPLICATION", { version: 1, result: "PASSED" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body.result, res.body.version, res.body.updatedBy.id], ["PASSED", 2, PART]);
    const o = ops(db.transactions()[0]);
    assert.ok(o.some((x) => x.Key?.SK === "META" && x.ExpressionAttributeValues?.[":v"] === "VALIDATION"));
    const audits = o.filter((x) => String(x.Item?.SK).startsWith("AUDIT#")).map((x) => x.Item);
    assert.deepEqual(audits.map((a) => [a.action, a.domain, a.toResult]), [["VALIDATION_UPDATED", "APPLICATION", "PASSED"]]);
  });

  test("failed and not applicable need a note", async () => {
    seedAll();
    assert.equal((await set(OWNER, "DATABASE", { version: 1, result: "FAILED" })).status, 400);
    assert.equal((await set(OWNER, "DATABASE", { version: 1, result: "NOT_APPLICABLE" })).status, 400);
    const ok = await set(OWNER, "DATABASE", { version: 1, result: "FAILED", note: " Row counts differ " });
    assert.deepEqual([ok.status, ok.body.note], [200, "Row counts differ"]);
  });

  test("the last open check also writes VALIDATION_COMPLETED", async () => {
    const items = seedAll("PASSED");
    db.put({ ...items[3], result: "PENDING" });
    const res = await set(OWNER, "INFRASTRUCTURE", { version: 1, result: "FAILED", note: "Latency" });
    assert.equal(res.status, 200);
    const audits = ops(db.transactions()[0]).filter((x) => String(x.Item?.SK).startsWith("AUDIT#")).map((x) => x.Item);
    assert.deepEqual(audits.map((a) => a.action), ["VALIDATION_UPDATED", "VALIDATION_COMPLETED"]);
    assert.equal(audits[1].failed, 1);
  });

  test("approvers 403, strangers 404, admin allowed, unknown domain 404, bad result 400", async () => {
    seedAll();
    assert.equal((await set(APPR, "OS", { version: 1, result: "PASSED" })).status, 403);
    assert.equal((await set(OTHER, "OS", { version: 1, result: "PASSED" })).status, 404);
    assert.equal((await set(ADMIN, "OS", { version: 1, result: "PASSED" }, "PlatformAdmin")).status, 200);
    assert.equal((await set(OWNER, "NETWORK", { version: 1, result: "PASSED" })).status, 404);
    assert.equal((await set(OWNER, "OS", { version: 1, result: "GREAT" })).status, 400);
  });

  test("only in Validation; stale version and concurrent change are 409", async () => {
    seedAll();
    assert.equal((await set(OWNER, "OS", { version: 7, result: "PASSED" })).body.error.code, "VERSION_CONFLICT");
    db.failNextTransactions = 1;
    assert.equal((await set(OWNER, "OS", { version: 1, result: "PASSED" })).body.error.code, "CONCURRENT_UPDATE");
    for (const status of ["IN_PROGRESS", "COMPLETED"]) {
      seedRequest({ status });
      assert.equal((await set(OWNER, "OS", { version: 1, result: "PASSED" })).body.error.code, "INVALID_STATE", status);
    }
  });
});

describe("closing: Validation -> Completed", () => {
  test("blocked while checks are pending", async () => {
    const items = seedAll("PASSED");
    db.put({ ...items[1], result: "PENDING" });
    const res = await close(OWNER, { summary: "Done" });
    assert.deepEqual([res.status, res.body.error.code], [409, "VALIDATION_INCOMPLETE"]);
    assert.deepEqual(res.body.error.details.map((d: any) => d.field), ["DATABASE"]);
    assert.equal(db.transactions().length, 0);
  });

  test("a closing summary is required", async () => {
    seedAll("PASSED");
    assert.equal((await close(OWNER, {})).status, 400);
    assert.equal((await close(OWNER, { summary: "   " })).status, 400);
    assert.equal((await close(OWNER, { summary: "x".repeat(5001) })).status, 400);
  });

  test("a failed check or an open issue requires the remaining issues text", async () => {
    const items = seedAll("PASSED");
    db.put({ ...items[0], result: "FAILED", note: "n" });
    const res = await close(OWNER, { summary: "Done" });
    assert.deepEqual([res.status, res.body.error.details[0].field], [400, "remainingIssues"]);
    assert.equal((await close(OWNER, { summary: "Done", remainingIssues: "App error 500 on /orders" })).status, 200);
    db.transactions().length = 0;
    seedAll("PASSED");
    seedIssue("OPEN");
    assert.equal((await close(OWNER, { summary: "Done" })).status, 400);
    seedIssue("RESOLVED");
    assert.equal((await close(OWNER, { summary: "Done" })).status, 200);
  });

  test("closing writes the final report in the same transaction, re-checks every result, and is for owner/admin only", async () => {
    seedAll("PASSED");
    assert.equal((await close(PART, { summary: "Done" })).status, 403);
    assert.equal((await close(APPR, { summary: "Done" })).status, 403);
    const res = await close(OWNER, { summary: " Patched without downtime " });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, "COMPLETED");
    const o = ops(db.transactions()[0]);
    const rep = o.find((x) => x.Item?.SK === "REPORT#FINAL");
    assert.equal(rep.ConditionExpression, "attribute_not_exists(PK)");
    assert.equal(rep.Item.summary, "Patched without downtime");
    assert.equal(o.filter((x) => String(x.Key?.SK).startsWith("VALID#")).length, 4);
    const audit = o.find((x) => String(x.Item?.SK).startsWith("AUDIT#")).Item;
    assert.deepEqual([audit.action, audit.toStatus, audit.finalReport], ["REQUEST_STATUS_CHANGED", "COMPLETED", true]);
  });

  test("a concurrent change fails the whole closing", async () => {
    seedAll("PASSED");
    db.failNextTransactions = 1;
    assert.equal((await close(OWNER, { summary: "Done" })).body.error.code, "CONCURRENT_UPDATE");
  });
});

describe("final report", () => {
  test("snapshot of the request, people, timeline, tasks, checklist, validation and issues", () => {
    const validationItems = buildValidationItems(RID, "t").map((i, n) => ({ ...i, result: n === 1 ? "FAILED" : "PASSED", note: n === 1 ? "Row counts differ" : undefined }));
    const rep = buildReport({
      request: { id: RID, requestNo: "REQ-0001", title: "Patch DB", description: "d", ownerId: OWNER, ownerName: "Owner", environment: "Production", cloudPlatform: "AWS", maintenanceType: "Patching", approvalPolicy: "ALL", approvalRound: 2, createdAt: "c", submittedAt: "s", scheduledAt: "sch", startedAt: "st" },
      members: [
        { userId: OWNER, displayName: "Owner", activityRole: "OWNER", status: "ACTIVE" },
        { userId: PART, displayName: "Part", activityRole: "PARTICIPANT", status: "ACTIVE", specialty: "Database", participation: "CONFIRMED" },
        { userId: U(6), displayName: "Gone", activityRole: "PARTICIPANT", status: "REMOVED" },
        { userId: APPR, displayName: "Appr", activityRole: "APPROVER", status: "ACTIVE" },
      ],
      tasks: [{ title: "Backup", assigneeName: "Part", status: "DONE" }, { title: "Patch", assigneeName: "Part", status: "TODO" }],
      readiness: [{ group: "BACKUP", title: "t", state: "DONE" }],
      validation: validationItems,
      activity: [{ type: "ISSUE", text: "x".repeat(400), severity: "HIGH", state: "OPEN", createdAt: "a" }, { type: "NOTE", text: "n", createdAt: "b" }],
      closure: { summary: "Done", remainingIssues: "One failed check" },
      completedBy: { userId: OWNER, displayName: "Owner" },
      now: "2026-12-02T00:00:00.000Z",
    });
    assert.deepEqual([rep.PK, rep.SK], [`REQ#${RID}`, "REPORT#FINAL"]);
    assert.deepEqual(rep.people.participants.map((p: any) => p.displayName), ["Part"], "removed members are left out");
    assert.equal(rep.timeline.completedAt, "2026-12-02T00:00:00.000Z");
    assert.deepEqual([rep.tasks.total, rep.tasks.done], [2, 1]);
    assert.deepEqual([rep.validation.passed, rep.validation.failed], [3, 1]);
    assert.equal(rep.activity.issues[0].text.length, 301, "long issue text is shortened");
    assert.equal(rep.remainingIssues, "One failed check");
  });

  test("GET /report: available only after closing, for any member; strangers get 404", async () => {
    seedAll("PASSED");
    assert.equal((await report(OWNER)).status, 404);
    db.put({ PK: `REQ#${RID}`, SK: "REPORT#FINAL", entityType: "FINAL_REPORT", requestId: RID, summary: "Done", generatedAt: "t" });
    const res = await report(APPR);
    assert.equal(res.status, 200);
    assert.deepEqual([res.body.summary, "PK" in res.body, "entityType" in res.body], ["Done", false, false]);
    assert.equal((await report(OTHER)).status, 404);
  });
});

describe("progress and notifications", () => {
  test("progress counts passed, failed and resolved", () => {
    assert.deepEqual(validationProgress([{ result: "PASSED" }, { result: "FAILED" }, { result: "NOT_APPLICABLE" }, { result: "PENDING" }]), { total: 4, resolved: 3, passed: 1, failed: 1, percent: 75 });
  });
  test("closing notifies every member except the actor; validation completion notifies owner and participants", () => {
    const req = { id: RID, requestNo: "REQ-0001", title: "Patch DB", ownerId: OWNER };
    const mem = [
      { userId: OWNER, activityRole: "OWNER", status: "ACTIVE" },
      { userId: PART, activityRole: "PARTICIPANT", status: "ACTIVE" },
      { userId: APPR, activityRole: "APPROVER", status: "ACTIVE" },
    ] as const;
    const who = (a: Record<string, unknown>) => planNotifications({ actorName: "A", ...a } as any, req, [...mem]).map((p) => `${p.recipientId.slice(-1)}:${p.type}`);
    assert.deepEqual(who({ action: "REQUEST_STATUS_CHANGED", actorId: OWNER, toStatus: "COMPLETED" }), ["3:REQUEST_STATUS_CHANGED", "5:REQUEST_STATUS_CHANGED"]);
    assert.deepEqual(who({ action: "VALIDATION_COMPLETED", actorId: PART }), ["1:VALIDATION_COMPLETED"]);
    assert.deepEqual(who({ action: "VALIDATION_UPDATED", actorId: PART }), []);
  });
  test("validateClosure returns whether anything remains", () => {
    const passed = buildValidationItems(RID, "t").map((i) => ({ ...i, result: "PASSED" }));
    assert.deepEqual(validateClosure({ items: passed, openIssues: 0, closure: { summary: "x" } }), { hasRemaining: false });
    assert.throws(() => validateClosure({ items: [], openIssues: 0, closure: { summary: "x" } }), (e: any) => e.code === "VALIDATION_INCOMPLETE");
  });
});

after(() => {
  const offenders = allSent.flatMap((s) => expressionsOf(s.input).map((e) => ({ cmd: s.name, e, bad: reservedWordsIn(e) }))).filter((x) => x.bad.length);
  assert.deepEqual(offenders, [], "no DynamoDB reserved word may appear un-aliased");
});
