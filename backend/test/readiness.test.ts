import "./helpers/env";
import { after, afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { handler as readiness } from "../src/handlers/readiness";
import { handler as requests } from "../src/handlers/requests";
import type { Item } from "../src/lib/db";
import { buildTemplateItems, CHECKLIST_GROUPS, progressOf, sortItems, validateReadinessGate } from "../src/lib/readiness";
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
    PK: `REQ#${RID}`, SK: "META", entityType: "REQUEST", id: RID, requestNo: "REQ-0001", title: "Patch DB", description: "d", status: "READINESS",
    ownerId: OWNER, ownerName: "Owner", ownerInitials: "Ow", createdAt: "2026-11-10T00:00:00.000Z", updatedAt: "2026-11-10T00:00:00.000Z", version: 5,
    scheduleStart: "2026-12-01T00:00:00.000Z", ...o,
  });
const seedMember = (userId: string, activityRole: string) =>
  db.put({ PK: `REQ#${RID}`, SK: `MEMBER#${userId}`, entityType: "MEMBER", requestId: RID, userId, displayName: `N${userId.slice(-1)}`, initials: "XX", activityRole, status: "ACTIVE" });
const seedChecklist = (state = "PENDING") => {
  const items: Item[] = buildTemplateItems(RID, "2026-11-11T00:00:00.000Z").map((i) => ({ ...i, state }));
  items.forEach((i) => db.put(i));
  return items;
};
const seedAll = (state = "PENDING") => {
  seedRequest();
  seedMember(OWNER, "OWNER");
  seedMember(PART, "PARTICIPANT");
  seedMember(APPR, "APPROVER");
  return seedChecklist(state);
};

const call = (h: any, method: string, resource: string, sub: string, body?: unknown, path: Record<string, string> = {}, groups = "") =>
  h(event({ method, resource, sub, groups, body, path: { requestId: RID, ...path } })).then(parse);
const list = (sub: string) => call(readiness, "GET", "/requests/{requestId}/readiness", sub);
const patch = (sub: string, id: string, body: unknown, groups = "") => call(readiness, "PATCH", "/requests/{requestId}/readiness/{itemId}", sub, body, { itemId: id }, groups);
const add = (sub: string, body: unknown) => call(readiness, "POST", "/requests/{requestId}/readiness", sub, body);
const del = (sub: string, id: string) => call(readiness, "DELETE", "/requests/{requestId}/readiness/{itemId}", sub, undefined, { itemId: id });
const move = (sub: string, to: string, version = 5) => call(requests, "POST", "/requests/{requestId}/transition", sub, { to, version });
const ops = (tx: any[]) => tx.map((t) => Object.values(t)[0] as any);

describe("template", () => {
  test("one default item for each SOW group, in order", () => {
    const items = buildTemplateItems(RID, "2026-11-11T00:00:00.000Z");
    assert.deepEqual(items.map((i) => i.group), [...CHECKLIST_GROUPS]);
    assert.deepEqual(CHECKLIST_GROUPS, ["BACKUP", "ACCESS", "FIREWALL_CONNECTIVITY", "TEAM_AVAILABILITY", "APP_DEPENDENCIES", "DOCUMENTATION"]);
    assert.ok(items.every((i) => i.state === "PENDING" && i.custom === false && i.version === 1));
    assert.deepEqual(sortItems([...items].reverse()).map((i) => i.group), [...CHECKLIST_GROUPS], "sorting restores template order");
  });
});

describe("entering READINESS copies the checklist", () => {
  test("Scheduled -> Readiness writes the six items in the same transaction", async () => {
    seedRequest({ status: "SCHEDULED" });
    seedMember(OWNER, "OWNER");
    const res = await move(OWNER, "READINESS");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const o = ops(db.transactions()[0]);
    const items = o.filter((x) => String(x.Item?.SK).startsWith("READY#"));
    assert.equal(items.length, 6);
    assert.ok(items.every((x) => x.ConditionExpression === "attribute_not_exists(PK)" && x.Item.state === "PENDING"));
  });
});

describe("gate: Readiness -> In Progress", () => {
  test("blocked while any item is pending, listing them", async () => {
    const items = seedAll("DONE");
    db.put({ ...items[2], state: "PENDING" });
    const res = await move(OWNER, "IN_PROGRESS");
    assert.deepEqual([res.status, res.body.error.code], [409, "READINESS_INCOMPLETE"]);
    assert.deepEqual(res.body.error.details.map((d: any) => d.field), [items[2].id]);
    assert.equal(db.transactions().length, 0);
  });

  test("allowed when every item is done or not applicable, and re-checks each item inside the transaction", async () => {
    const items = seedAll("DONE");
    db.put({ ...items[0], state: "NOT_APPLICABLE", note: "No DB" });
    const res = await move(OWNER, "IN_PROGRESS");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const checks = ops(db.transactions()[0]).filter((x) => String(x.Key?.SK).startsWith("READY#"));
    assert.equal(checks.length, 6);
    assert.ok(checks.every((c) => /#st <> :pending/.test(c.ConditionExpression)));
  });

  test("a request without any checklist cannot start", () => {
    assert.throws(() => validateReadinessGate([]), (e: any) => e.code === "READINESS_INCOMPLETE");
  });

  test("a concurrent un-check makes the transaction fail with 409", async () => {
    seedAll("DONE");
    db.failNextTransactions = 1;
    assert.equal((await move(OWNER, "IN_PROGRESS")).body.error.code, "CONCURRENT_UPDATE");
  });
});

describe("GET /requests/{id}/readiness", () => {
  test("members and admin read items with progress; strangers get 404", async () => {
    const items = seedAll("PENDING");
    db.put({ ...items[0], state: "DONE" });
    db.put({ ...items[1], state: "NOT_APPLICABLE", note: "n/a" });
    const res = await list(APPR);
    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, 6);
    assert.deepEqual(res.body.progress, { total: 6, resolved: 2, done: 1, percent: 33 });
    assert.equal(res.body.started, true);
    assert.equal((await list(OTHER)).status, 404);
  });
  test("before the stage starts there are no items", async () => {
    seedRequest({ status: "APPROVED" });
    seedMember(OWNER, "OWNER");
    const res = await list(OWNER);
    assert.deepEqual([res.body.items, res.body.started], [[], false]);
  });
});

describe("PATCH /requests/{id}/readiness/{itemId}", () => {
  test("a participant marks an item done: version condition, still-in-readiness check, READINESS_UPDATED audit", async () => {
    const items = seedAll();
    const res = await patch(PART, items[0].id, { version: 1, state: "DONE" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body.state, res.body.version, res.body.updatedBy.id], ["DONE", 2, PART]);
    const o = ops(db.transactions()[0]);
    assert.match(o[0].ConditionExpression, /#v = :v/);
    assert.ok(o.some((x) => x.Key?.SK === "META" && x.ExpressionAttributeValues?.[":r"] === "READINESS"));
    const audit = o.find((x) => String(x.Item?.SK).startsWith("AUDIT#")).Item;
    assert.deepEqual([audit.action, audit.toState, audit.fromState, audit.itemTitle], ["READINESS_UPDATED", "DONE", "PENDING", items[0].title]);
  });

  test("not applicable needs a reason; a reason is stored; setting back to pending clears nothing it should not", async () => {
    const items = seedAll();
    assert.equal((await patch(OWNER, items[0].id, { version: 1, state: "NOT_APPLICABLE" })).status, 400);
    const ok = await patch(OWNER, items[0].id, { version: 1, state: "NOT_APPLICABLE", note: "  No database  " });
    assert.deepEqual([ok.status, ok.body.note], [200, "No database"]);
    const back = await patch(OWNER, items[1].id, { version: 1, state: "PENDING" });
    assert.deepEqual([back.status, back.body.note], [200, null]);
  });

  test("approvers and strangers cannot update; admin can", async () => {
    const items = seedAll();
    assert.equal((await patch(APPR, items[0].id, { version: 1, state: "DONE" })).status, 403);
    assert.equal((await patch(OTHER, items[0].id, { version: 1, state: "DONE" })).status, 404);
    assert.equal((await patch(ADMIN, items[0].id, { version: 1, state: "DONE" }, "PlatformAdmin")).status, 200);
  });

  test("only while the request is in Readiness", async () => {
    const items = seedAll();
    for (const status of ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]) {
      seedRequest({ status });
      assert.equal((await patch(OWNER, items[0].id, { version: 1, state: "DONE" })).body.error.code, "INVALID_STATE", status);
    }
  });

  test("stale version 409, bad state 400, unknown item 404, concurrent change 409", async () => {
    const items = seedAll();
    assert.equal((await patch(OWNER, items[0].id, { version: 9, state: "DONE" })).body.error.code, "VERSION_CONFLICT");
    assert.equal((await patch(OWNER, items[0].id, { version: 1, state: "MAYBE" })).status, 400);
    assert.equal((await patch(OWNER, items[0].id, { state: "DONE" })).status, 400);
    assert.equal((await patch(OWNER, "01JC00000000000000000000ZZ", { version: 1, state: "DONE" })).status, 404);
    db.failNextTransactions = 1;
    assert.equal((await patch(OWNER, items[0].id, { version: 1, state: "DONE" })).body.error.code, "CONCURRENT_UPDATE");
  });
});

describe("custom items", () => {
  test("owner adds and deletes a custom item; template items cannot be deleted; participants cannot add", async () => {
    const items = seedAll();
    assert.equal((await add(PART, { group: "BACKUP", title: "x" })).status, 403);
    const res = await add(OWNER, { group: "BACKUP", title: " Snapshot the volume " });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual([res.body.custom, res.body.title, res.body.state], [true, "Snapshot the volume", "PENDING"]);
    assert.equal((await del(OWNER, items[0].id)).body.error.code, "TEMPLATE_ITEM");
    const custom = ops(db.transactions()[0])[0].Item;
    db.put(custom);
    assert.equal((await del(PART, custom.id)).status, 403);
    assert.equal((await del(OWNER, custom.id)).status, 204);
    assert.equal(ops(db.transactions()[1]).find((x) => String(x.Item?.SK).startsWith("AUDIT#")).Item.action, "READINESS_ITEM_DELETED");
  });

  test("validation and limit", async () => {
    seedAll();
    assert.equal((await add(OWNER, { group: "NOPE", title: "x" })).status, 400);
    assert.equal((await add(OWNER, { group: "BACKUP", title: "  " })).status, 400);
    for (let i = 0; i < 30; i++) db.put({ PK: `REQ#${RID}`, SK: `READY#01JC0000000000000000${String(i).padStart(6, "0")}`, custom: true, state: "PENDING" });
    assert.equal((await add(OWNER, { group: "BACKUP", title: "one more" })).body.error.code, "ITEM_LIMIT");
  });
});

describe("progress and notifications", () => {
  test("progress counts done and not applicable as resolved", () => {
    assert.deepEqual(progressOf([{ state: "DONE" }, { state: "NOT_APPLICABLE" }, { state: "PENDING" }, { state: "PENDING" }]), { total: 4, resolved: 2, done: 1, percent: 50 });
    assert.deepEqual(progressOf([]), { total: 0, resolved: 0, done: 0, percent: 0 });
  });
  test("an update notifies the owner, never the person who made it", () => {
    const req = { id: RID, requestNo: "REQ-0001", title: "Patch DB", ownerId: OWNER };
    const mem = [{ userId: OWNER, activityRole: "OWNER", status: "ACTIVE" }, { userId: PART, activityRole: "PARTICIPANT", status: "ACTIVE" }] as const;
    assert.deepEqual(planNotifications({ action: "READINESS_UPDATED", actorId: PART, actorName: "P" }, req, [...mem]).map((p) => p.recipientId), [OWNER]);
    assert.deepEqual(planNotifications({ action: "READINESS_UPDATED", actorId: OWNER, actorName: "O" }, req, [...mem]), []);
    assert.deepEqual(planNotifications({ action: "READINESS_ITEM_ADDED", actorId: OWNER, actorName: "O" }, req, [...mem]), []);
  });
});

after(() => {
  const offenders = allSent.flatMap((s) => expressionsOf(s.input).map((e) => ({ cmd: s.name, e, bad: reservedWordsIn(e) }))).filter((x) => x.bad.length);
  assert.deepEqual(offenders, [], "no DynamoDB reserved word may appear un-aliased");
});
