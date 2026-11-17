import "./helpers/env";
import { after, afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { handler as schedule } from "../src/handlers/schedule";
import { overlaps, sharedPeople, sharedSystems, windowOf, monthsFor, isActiveForConflicts } from "../src/lib/schedule";
import { event, expressionsOf, FakeDb, parse, reservedWordsIn, type Sent } from "./helpers/fakeDb";

const U = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), PART = U(3), OTHER = U(4), APPR = U(5), ADMIN = U(9);
const A = "01JC0000000000000000000001", B = "01JC0000000000000000000002", C = "01JC0000000000000000000003";
let db: FakeDb;
const allSent: Sent[] = [];
beforeEach(() => {
  db = new FakeDb().install();
});
afterEach(() => {
  allSent.push(...db.sent);
  db.uninstall();
});

const seed = (id: string, o: Record<string, unknown> = {}) => {
  const start = (o.scheduleStart as string) ?? "2026-12-10T09:00:00.000Z";
  db.put({
    PK: `REQ#${id}`, SK: "META", entityType: "REQUEST", id, requestNo: `REQ-${id.slice(-1).padStart(4, "0")}`, title: `Title ${id.slice(-1)}`, status: "SCHEDULED",
    ownerId: OWNER, ownerName: "Owner", ownerInitials: "Ow", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "x", version: 1, environment: "Production",
    affectedSystems: ["orders-db"], scheduleStart: start, scheduleEnd: "2026-12-10T13:00:00.000Z", GSI3PK: `SCHED#${start.slice(0, 7)}`, GSI3SK: `${start}#${id}`, ...o,
  });
};
const member = (id: string, userId: string, role: string, status = "ACTIVE") =>
  db.put({ PK: `REQ#${id}`, SK: `MEMBER#${userId}`, entityType: "MEMBER", requestId: id, userId, displayName: `N${userId.slice(-1)}`, initials: "XX", activityRole: role, status });

const call = (resource: string, sub: string, o: { query?: Record<string, string>; path?: Record<string, string>; groups?: string } = {}) =>
  schedule(event({ method: "GET", resource, sub, groups: o.groups, query: o.query, path: o.path })).then(parse);
const conflicts = (id: string, sub: string, groups = "") => call("/requests/{requestId}/conflicts", sub, { path: { requestId: id }, groups });
const range = (sub: string, from = "2026-12-01", to = "2026-12-31", groups = "") => call("/schedule", sub, { query: { from, to }, groups });

describe("rules", () => {
  test("windows: explicit end, or 24 hours when there is none", () => {
    assert.deepEqual(windowOf({ scheduleStart: "2026-12-10T00:00:00.000Z", scheduleEnd: "2026-12-10T04:00:00.000Z" }), { start: Date.parse("2026-12-10T00:00:00.000Z"), end: Date.parse("2026-12-10T04:00:00.000Z") });
    const w = windowOf({ scheduleStart: "2026-12-10T00:00:00.000Z" })!;
    assert.equal(w.end - w.start, 86_400_000);
    assert.equal(windowOf({ scheduleStart: "2026-12-10T00:00:00.000Z", scheduleEnd: "2026-12-09T00:00:00.000Z" })!.end - w.start, 86_400_000, "an end before the start is ignored");
    assert.equal(windowOf({}), undefined);
  });
  test("overlap is strict: touching windows do not overlap", () => {
    const a = { scheduleStart: "2026-12-10T00:00:00.000Z", scheduleEnd: "2026-12-10T04:00:00.000Z" };
    assert.equal(overlaps(a, { scheduleStart: "2026-12-10T03:59:00.000Z", scheduleEnd: "2026-12-10T08:00:00.000Z" }), true);
    assert.equal(overlaps(a, { scheduleStart: "2026-12-10T04:00:00.000Z", scheduleEnd: "2026-12-10T08:00:00.000Z" }), false);
    assert.equal(overlaps(a, {}), false);
  });
  test("shared systems need the same environment; names ignore case and spaces", () => {
    const a = { environment: "Production", affectedSystems: ["Orders  DB", "api"] };
    assert.deepEqual(sharedSystems(a, { environment: "production", affectedSystems: ["orders db"] }), ["Orders  DB"]);
    assert.deepEqual(sharedSystems(a, { environment: "Staging", affectedSystems: ["orders db"] }), []);
    assert.deepEqual(sharedSystems({ affectedSystems: ["x"] }, { affectedSystems: ["x"] }), [], "no environment, no system conflict");
  });
  test("people: only active owners and participants count (not approvers or removed members)", () => {
    const m = (userId: string, activityRole: string, status = "ACTIVE") => ({ userId, activityRole, status, displayName: userId });
    assert.deepEqual(sharedPeople([m("1", "OWNER"), m("2", "APPROVER"), m("3", "PARTICIPANT", "REMOVED")], [m("1", "PARTICIPANT"), m("2", "PARTICIPANT"), m("3", "PARTICIPANT")]).map((x) => x.userId), ["1"]);
  });
  test("only planned or running activities are compared", () => {
    for (const s of ["PENDING_APPROVAL", "APPROVED", "SCHEDULED", "READINESS", "IN_PROGRESS", "VALIDATION"]) assert.equal(isActiveForConflicts({ status: s, scheduleStart: "x" }), true, s);
    for (const s of ["DRAFT", "REJECTED", "CANCELLED", "COMPLETED"]) assert.equal(isActiveForConflicts({ status: s, scheduleStart: "x" }), false, s);
    assert.equal(isActiveForConflicts({ status: "SCHEDULED" }), false);
  });
  test("month partitions include the month before the range", () => {
    assert.deepEqual(monthsFor(Date.parse("2026-12-05T00:00:00Z"), Date.parse("2027-01-10T00:00:00Z")), ["2026-11", "2026-12", "2027-01"]);
  });
});

describe("GET /requests/{id}/conflicts", () => {
  test("a shared system in the same environment is a SYSTEM conflict, with details for activities you belong to", async () => {
    seed(A);
    seed(B, { scheduleStart: "2026-12-10T11:00:00.000Z", scheduleEnd: "2026-12-10T15:00:00.000Z" });
    member(A, OWNER, "OWNER");
    member(B, OWNER, "OWNER");
    const res = await conflicts(A, OWNER);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.items.length, 1);
    const c = res.body.items[0];
    assert.deepEqual([c.restricted, c.requestId, c.requestNo, c.title], [false, B, "REQ-0002", "Title 2"]);
    assert.ok(c.reasons.some((r: any) => r.type === "SYSTEM" && r.systems[0] === "orders-db"));
    assert.ok(c.reasons.some((r: any) => r.type === "PEOPLE" && r.people[0].id === OWNER), "the owner works on both");
  });

  test("a conflict with an activity you cannot see is redacted: no number, title, systems or people", async () => {
    seed(A);
    seed(B, { ownerId: OTHER, scheduleStart: "2026-12-10T11:00:00.000Z" });
    member(A, OWNER, "OWNER");
    member(B, OTHER, "OWNER");
    const res = await conflicts(A, OWNER);
    const c = res.body.items[0];
    assert.deepEqual([c.restricted, c.requestId, c.requestNo, c.title], [true, null, null, null]);
    assert.deepEqual(c.reasons.map((r: any) => r.type), ["SYSTEM"]);
    assert.equal(c.reasons[0].systems, undefined);
    assert.equal(c.start, "2026-12-10T11:00:00.000Z", "the time window is still shown");
    assert.ok(!JSON.stringify(res.body).includes("orders-db") && !JSON.stringify(res.body).includes("Title 2"));
    // An admin sees everything.
    const admin = await conflicts(A, ADMIN, "PlatformAdmin");
    assert.equal(admin.body.items[0].requestNo, "REQ-0002");
  });

  test("a shared person alone is a PEOPLE conflict (different systems)", async () => {
    seed(A);
    seed(B, { affectedSystems: ["billing"], scheduleStart: "2026-12-10T10:00:00.000Z" });
    member(A, OWNER, "OWNER");
    member(A, PART, "PARTICIPANT");
    member(B, OTHER, "OWNER");
    member(B, PART, "PARTICIPANT");
    member(B, OWNER, "APPROVER"); // approvers do not count
    const res = await conflicts(A, PART);
    assert.deepEqual(res.body.items[0].reasons.map((r: any) => r.type), ["PEOPLE"]);
    assert.deepEqual(res.body.items[0].reasons[0].people.map((p: any) => p.id), [PART]);
  });

  test("no overlap, different environment and different people means no conflict; drafts, cancelled and completed are ignored", async () => {
    seed(A);
    member(A, OWNER, "OWNER");
    seed(B, { scheduleStart: "2026-12-11T09:00:00.000Z", scheduleEnd: "2026-12-11T10:00:00.000Z" });
    seed(C, { environment: "Staging", scheduleStart: "2026-12-10T10:00:00.000Z" });
    member(C, OTHER, "OWNER");
    assert.deepEqual((await conflicts(A, OWNER)).body.items, []);
    seed(B, { status: "CANCELLED", scheduleStart: "2026-12-10T10:00:00.000Z" });
    member(B, OWNER, "OWNER");
    assert.deepEqual((await conflicts(A, OWNER)).body.items, [], "cancelled is ignored");
  });

  test("a draft is checked against others before it is even submitted; a request without a schedule has nothing to check", async () => {
    seed(A, { status: "DRAFT", GSI3PK: undefined, GSI3SK: undefined });
    seed(B, { scheduleStart: "2026-12-10T10:00:00.000Z" });
    member(A, OWNER, "OWNER");
    member(B, OTHER, "OWNER");
    assert.equal((await conflicts(A, OWNER)).body.items.length, 1);
    seed(C, { status: "DRAFT", scheduleStart: undefined, scheduleEnd: undefined, GSI3PK: undefined, GSI3SK: undefined });
    member(C, OWNER, "OWNER");
    assert.deepEqual((await conflicts(C, OWNER)).body, { items: [], scheduled: false });
  });

  test("strangers get 404", async () => {
    seed(A);
    member(A, OWNER, "OWNER");
    assert.equal((await conflicts(A, OTHER)).status, 404);
  });
});

describe("GET /schedule", () => {
  test("members see their activities in range, with a conflict count; others stay invisible", async () => {
    seed(A);
    seed(B, { scheduleStart: "2026-12-10T11:00:00.000Z" });
    seed(C, { scheduleStart: "2026-12-20T09:00:00.000Z", scheduleEnd: "2026-12-20T10:00:00.000Z", ownerId: OTHER });
    member(A, OWNER, "OWNER");
    member(B, OTHER, "OWNER");
    member(C, OTHER, "OWNER");
    const res = await range(OWNER);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.items.map((i: any) => [i.requestId, i.conflictCount]), [[A, 1]]);
    assert.equal(res.body.conflicts, 1);
    assert.ok(!JSON.stringify(res.body).includes("Title 2"), "the other activity's details never leak");
  });

  test("admin sees everything, sorted by start", async () => {
    seed(B, { scheduleStart: "2026-12-12T09:00:00.000Z", scheduleEnd: "2026-12-12T10:00:00.000Z" });
    seed(A);
    seed(C, { scheduleStart: "2026-12-20T09:00:00.000Z", scheduleEnd: "2026-12-20T10:00:00.000Z", status: "COMPLETED" });
    const res = await range(ADMIN, "2026-12-01", "2026-12-31", "PlatformAdmin");
    assert.deepEqual(res.body.items.map((i: any) => i.requestId), [A, B]);
  });

  test("an activity that started the month before and runs into the range is included", async () => {
    seed(A, { scheduleStart: "2026-11-30T20:00:00.000Z", scheduleEnd: "2026-12-02T04:00:00.000Z" });
    member(A, OWNER, "OWNER");
    assert.deepEqual((await range(OWNER)).body.items.map((i: any) => i.requestId), [A]);
  });

  test("defaults to the next 30 days; bad or oversized ranges are 400", async () => {
    assert.equal((await call("/schedule", OWNER)).status, 200);
    assert.equal((await range(OWNER, "12/01/2026", "2026-12-31")).status, 400);
    assert.equal((await range(OWNER, "2026-12-31", "2026-12-01")).status, 400);
    assert.equal((await range(OWNER, "2026-01-01", "2026-12-31")).status, 400);
  });

  test("approvers and participants see activities they belong to", async () => {
    seed(A);
    member(A, OWNER, "OWNER");
    member(A, APPR, "APPROVER");
    assert.equal((await range(APPR)).body.items.length, 1);
    assert.equal((await range(OTHER)).body.items.length, 0);
  });
});

after(() => {
  const offenders = allSent.flatMap((s) => expressionsOf(s.input).map((e) => ({ cmd: s.name, e, bad: reservedWordsIn(e) }))).filter((x) => x.bad.length);
  assert.deepEqual(offenders, [], "no DynamoDB reserved word may appear un-aliased");
});
