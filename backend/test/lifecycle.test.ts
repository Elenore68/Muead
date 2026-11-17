import "./helpers/env";
import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { handler as requests } from "../src/handlers/requests";
import { handler as reference } from "../src/handlers/reference";
import { availableActions, CANCELLABLE, NEXT_STATUS, validateTransition } from "../src/lib/lifecycle";
import { planNotifications } from "../src/lib/notifications";
import { STATUSES } from "../src/lib/requests";
import { event, expressionsOf, FakeDb, parse, reservedWordsIn } from "./helpers/fakeDb";

const U = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), PART = U(3), OTHER = U(4), ADMIN = U(9);
const RID = "01JC0000000000000000000001";
let db: FakeDb;
beforeEach(() => {
  db = new FakeDb().install();
});
afterEach(() => db.uninstall());

const seedRequest = (o: Record<string, unknown> = {}) =>
  db.put({
    PK: `REQ#${RID}`, SK: "META", entityType: "REQUEST", id: RID, requestNo: "REQ-0001", title: "Patch DB", description: "Monthly patching",
    status: "APPROVED", approvalState: "APPROVED", approvalRound: 1, approvalPolicy: "ANY_ONE", ownerId: OWNER, ownerName: "Owner", ownerInitials: "Ow",
    membersRev: 1, createdAt: "2026-11-10T00:00:00.000Z", updatedAt: "2026-11-10T00:00:00.000Z", version: 7, category: "IT",
    environment: "Production", cloudPlatform: "AWS", maintenanceType: "Patching", scheduleStart: "2026-12-01T00:00:00.000Z", ...o,
  });
const seedMember = (userId: string, activityRole: string) =>
  db.put({ PK: `REQ#${RID}`, SK: `MEMBER#${userId}`, entityType: "MEMBER", requestId: RID, userId, displayName: userId.slice(-4), initials: "XX", activityRole, status: "ACTIVE" });

const move = (sub: string, body: unknown, groups = "") =>
  requests(event({ method: "POST", resource: "/requests/{requestId}/transition", sub, groups, body, path: { requestId: RID } })).then(parse);
const cancel = (sub: string, body: unknown, groups = "") =>
  requests(event({ method: "POST", resource: "/requests/{requestId}/cancel", sub, groups, body, path: { requestId: RID } })).then(parse);

describe("lifecycle rules (pure)", () => {
  test("the forward path is exactly Approved > Scheduled > Readiness > In Progress > Validation > Completed", () => {
    let s = "APPROVED";
    const path = [s];
    while (NEXT_STATUS[s as keyof typeof NEXT_STATUS]) {
      s = NEXT_STATUS[s as keyof typeof NEXT_STATUS]!;
      path.push(s);
    }
    assert.deepEqual(path, ["APPROVED", "SCHEDULED", "READINESS", "IN_PROGRESS", "VALIDATION", "COMPLETED"]);
  });

  test("every allowed and every forbidden (from, to) pair", () => {
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        const ok = NEXT_STATUS[from] === to;
        let threw = false;
        try {
          validateTransition({ canEdit: true, request: { status: from, scheduleStart: "2026-12-01T00:00:00.000Z" }, to });
        } catch {
          threw = true;
        }
        assert.equal(!threw, ok, `${from} -> ${to}`);
      }
    }
  });

  test("cancel is allowed before execution only; never from pending approval, in progress or finished", () => {
    assert.deepEqual([...CANCELLABLE].sort(), ["APPROVED", "DRAFT", "READINESS", "REJECTED", "SCHEDULED"]);
    for (const s of ["PENDING_APPROVAL", "IN_PROGRESS", "VALIDATION", "COMPLETED", "CANCELLED"]) {
      assert.equal(availableActions(s, true).canCancel, false, s);
    }
  });

  test("non-editors are offered nothing", () => {
    assert.deepEqual(availableActions("APPROVED", false), { next: null, canCancel: false });
    assert.deepEqual(availableActions("APPROVED", true), { next: "SCHEDULED", canCancel: true });
  });
});

describe("POST /requests/{id}/transition", () => {
  test("owner moves Approved -> Scheduled in one transaction with version/status conditions, audit and counters", async () => {
    seedRequest();
    seedMember(OWNER, "OWNER");
    const res = await move(OWNER, { to: "SCHEDULED", version: 7 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body.status, res.body.previousStatus, res.body.version], ["SCHEDULED", "APPROVED", 8]);
    const [tx] = db.transactions();
    const ops = tx.map((t: any) => Object.values(t)[0] as any);
    const req = ops.find((o) => o.Item?.SK === "META");
    assert.equal(req.Item.status, "SCHEDULED");
    assert.equal(req.Item.GSI2PK, "STATUS#SCHEDULED", "status index recomputed");
    assert.equal(req.Item.GSI3PK, "SCHED#2026-12", "schedule index present once scheduled");
    assert.match(req.ConditionExpression, /#v = :v AND #s = :from/);
    assert.deepEqual([req.ExpressionAttributeValues[":v"], req.ExpressionAttributeValues[":from"]], [7, "APPROVED"]);
    const audit = ops.find((o) => String(o.Item?.SK).startsWith("AUDIT#"));
    assert.deepEqual([audit.Item.action, audit.Item.fromStatus, audit.Item.toStatus, audit.Item.actorActivityRole], ["REQUEST_STATUS_CHANGED", "APPROVED", "SCHEDULED", "OWNER"]);
    const stats = ops.filter((o) => o.Key?.PK === "STATS#GLOBAL").map((o) => [o.Key.SK, o.ExpressionAttributeValues[":by"]]);
    assert.deepEqual(stats, [["STATUS#APPROVED", -1], ["STATUS#SCHEDULED", 1]]);
  });

  test("walks the whole path to Completed, stamping the milestones", async () => {
    const steps = ["SCHEDULED", "READINESS", "IN_PROGRESS", "VALIDATION", "COMPLETED"];
    seedRequest();
    seedMember(OWNER, "OWNER");
    let version = 7;
    for (const to of steps) {
      const res = await requests(event({ method: "POST", resource: "/requests/{requestId}/transition", sub: OWNER, body: { to, version, summary: "All good" }, path: { requestId: RID } })).then(parse);
      assert.equal(res.status, 200, `${to}: ${JSON.stringify(res.body)}`);
      version = res.body.version;
      // The fake does not apply transactions: re-seed the request as the transaction wrote it.
      const tx = db.transactions().at(-1)!;
      const written = (Object.values(tx.find((t: any) => t.Put?.Item?.SK === "META")) [0] as any).Item;
      db.put(written);
      // Entering READINESS copies the checklist onto the request; the team then completes it before the next step.
      for (const t of tx) {
        const it = (t as any).Put?.Item;
        if (it?.SK?.startsWith("READY#")) db.put({ ...it, state: "DONE" });
        if (it?.SK?.startsWith("VALID#")) db.put({ ...it, result: "PASSED" });
      }
    }
    const final = db.get(`REQ#${RID}`, "META")!;
    assert.equal(final.status, "COMPLETED");
    for (const k of ["scheduledAt", "readinessStartedAt", "startedAt", "validationStartedAt", "completedAt"]) assert.ok(final[k], k);
  });

  test("skipping a step, going backwards or using a cancel target is 409 INVALID_TRANSITION", async () => {
    seedRequest();
    seedMember(OWNER, "OWNER");
    for (const to of ["READINESS", "IN_PROGRESS", "COMPLETED", "APPROVED", "DRAFT", "CANCELLED"]) {
      const res = await move(OWNER, { to, version: 7 });
      assert.deepEqual([res.status, res.body.error.code], [409, "INVALID_TRANSITION"], to);
    }
    assert.equal(db.transactions().length, 0);
  });

  test("Draft, Pending, Rejected, Completed and Cancelled cannot move forward", async () => {
    for (const status of ["DRAFT", "PENDING_APPROVAL", "REJECTED", "COMPLETED", "CANCELLED"]) {
      seedRequest({ status });
      seedMember(OWNER, "OWNER");
      const res = await move(OWNER, { to: "SCHEDULED", version: 7 });
      assert.deepEqual([res.status, res.body.error.code], [409, "INVALID_TRANSITION"], status);
    }
  });

  test("scheduling needs a start date", async () => {
    seedRequest({ scheduleStart: undefined });
    seedMember(OWNER, "OWNER");
    const res = await move(OWNER, { to: "SCHEDULED", version: 7 });
    assert.deepEqual([res.status, res.body.error.code], [400, "SCHEDULE_REQUIRED"]);
  });

  test("participant 403, stranger 404, unassigned admin allowed", async () => {
    seedRequest();
    seedMember(OWNER, "OWNER");
    seedMember(PART, "PARTICIPANT");
    assert.equal((await move(PART, { to: "SCHEDULED", version: 7 })).status, 403);
    assert.equal((await move(OTHER, { to: "SCHEDULED", version: 7 })).status, 404);
    const res = await move(ADMIN, { to: "SCHEDULED", version: 7 }, "PlatformAdmin");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const audit = db.transactions()[0].map((t: any) => Object.values(t)[0] as any).find((o) => String(o.Item?.SK).startsWith("AUDIT#"));
    assert.equal(audit.Item.actorActivityRole, "PLATFORM_ADMIN");
  });

  test("stale version -> 409 VERSION_CONFLICT; missing version or target -> 400", async () => {
    seedRequest();
    seedMember(OWNER, "OWNER");
    assert.equal((await move(OWNER, { to: "SCHEDULED", version: 3 })).body.error.code, "VERSION_CONFLICT");
    assert.equal((await move(OWNER, { to: "SCHEDULED" })).status, 400);
    assert.equal((await move(OWNER, { version: 7 })).status, 400);
  });

  test("a concurrent change makes the transaction fail with 409 CONCURRENT_UPDATE", async () => {
    seedRequest();
    seedMember(OWNER, "OWNER");
    db.failNextTransactions = 1;
    const res = await move(OWNER, { to: "SCHEDULED", version: 7 });
    assert.deepEqual([res.status, res.body.error.code], [409, "CONCURRENT_UPDATE"]);
  });
});

describe("POST /requests/{id}/cancel", () => {
  test("owner cancels with a reason; cancelled stays out of every further transition", async () => {
    seedRequest({ status: "SCHEDULED" });
    seedMember(OWNER, "OWNER");
    const res = await cancel(OWNER, { reason: "Freeze window", version: 7 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const ops = db.transactions()[0].map((t: any) => Object.values(t)[0] as any);
    const req = ops.find((o) => o.Item?.SK === "META");
    assert.deepEqual([req.Item.status, req.Item.cancelReason, req.Item.cancelledBy], ["CANCELLED", "Freeze window", OWNER]);
    const audit = ops.find((o) => String(o.Item?.SK).startsWith("AUDIT#"));
    assert.deepEqual([audit.Item.toStatus, audit.Item.reason], ["CANCELLED", "Freeze window"]);

    db.put(req.Item);
    assert.equal((await move(OWNER, { to: "SCHEDULED", version: 8 })).body.error.code, "INVALID_TRANSITION");
    assert.equal((await cancel(OWNER, { reason: "again", version: 8 })).body.error.code, "INVALID_TRANSITION");
  });

  test("allowed before execution, refused afterwards", async () => {
    seedMember(OWNER, "OWNER");
    for (const status of ["DRAFT", "REJECTED", "APPROVED", "SCHEDULED", "READINESS"]) {
      seedRequest({ status });
      assert.equal((await cancel(OWNER, { reason: "x", version: 7 })).status, 200, status);
    }
    for (const status of ["PENDING_APPROVAL", "IN_PROGRESS", "VALIDATION", "COMPLETED"]) {
      seedRequest({ status });
      assert.equal((await cancel(OWNER, { reason: "x", version: 7 })).body.error.code, "INVALID_TRANSITION", status);
    }
  });

  test("reason is required; participant 403; stale version 409", async () => {
    seedRequest();
    seedMember(OWNER, "OWNER");
    seedMember(PART, "PARTICIPANT");
    assert.equal((await cancel(OWNER, { reason: "  ", version: 7 })).status, 400);
    assert.equal((await cancel(PART, { reason: "x", version: 7 })).status, 403);
    assert.equal((await cancel(OWNER, { reason: "x", version: 1 })).body.error.code, "VERSION_CONFLICT");
  });
});

describe("GET /requests/{id} and reference data", () => {
  test("viewer.lifecycle tells the UI what this caller may do", async () => {
    seedRequest();
    seedMember(OWNER, "OWNER");
    seedMember(PART, "PARTICIPANT");
    const get = (sub: string) => requests(event({ method: "GET", resource: "/requests/{requestId}", sub, path: { requestId: RID } })).then(parse);
    assert.deepEqual((await get(OWNER)).body.viewer.lifecycle, { next: "SCHEDULED", canCancel: true });
    assert.deepEqual((await get(PART)).body.viewer.lifecycle, { next: null, canCancel: false });
  });

  test("GET /reference-data returns the confirmed dropdown values", async () => {
    const res = parse(await reference(event({ method: "GET", resource: "/reference-data", sub: OWNER })));
    assert.deepEqual(res.body.environments, ["Development", "Testing", "Staging", "Production", "Disaster Recovery"]);
    assert.deepEqual(res.body.cloudPlatforms, ["AWS", "Azure", "Google Cloud", "Hybrid", "Other"]);
    assert.deepEqual(res.body.maintenanceTypes, ["Planned Maintenance", "Emergency Maintenance", "Preventive Maintenance", "Corrective Maintenance", "Upgrade", "Patching"]);
  });
});

describe("request form fields", () => {
  const create = (body: unknown) => requests(event({ method: "POST", resource: "/requests", sub: OWNER, body })).then(parse);
  test("create saves the SOW fields; values outside the lists are rejected", async () => {
    const ok = await create({
      title: "t", description: "d", environment: "Staging", cloudPlatform: "Google Cloud", maintenanceType: "Upgrade", scope: "DB tier",
      affectedSystems: ["orders-db"], links: [{ label: "Runbook", url: "https://example.com/rb" }], schedule: { start: "2026-12-01T00:00:00.000Z", end: "2026-12-01T04:00:00.000Z" },
    });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.deepEqual([ok.body.environment, ok.body.cloudPlatform, ok.body.maintenanceType], ["Staging", "Google Cloud", "Upgrade"]);
    for (const bad of [{ environment: "Moon" }, { cloudPlatform: "Oracle" }, { maintenanceType: "Whatever" }]) {
      const res = await create({ title: "t", description: "d", ...bad });
      assert.equal(res.status, 400, JSON.stringify(bad));
      assert.equal(res.body.error.details[0].issue, "enum");
    }
  });

  test("PATCH edits a draft, keeps version control and refuses edits after approval", async () => {
    seedRequest({ status: "DRAFT", version: 1 });
    seedMember(OWNER, "OWNER");
    const patch = (body: unknown) => requests(event({ method: "PATCH", resource: "/requests/{requestId}", sub: OWNER, body, path: { requestId: RID } })).then(parse);
    const res = await patch({ version: 1, environment: "Testing", scope: "New scope" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body.environment, res.body.scope, res.body.version], ["Testing", "New scope", 2]);
    // The fake does not apply transactions: store what the transaction wrote, so version 1 is now stale.
    db.put((Object.values(db.transactions()[0].find((t: any) => t.Put?.Item?.SK === "META")) [0] as any).Item);
    assert.equal((await patch({ version: 1, scope: "x" })).body.error.code, "VERSION_CONFLICT");
    assert.equal((await patch({ version: 2, environment: "Nope" })).status, 400);
    seedRequest({ status: "APPROVED", version: 3 });
    assert.equal((await patch({ version: 3, scope: "x" })).body.error.code, "INVALID_TRANSITION");
  });
});

describe("notifications for status changes", () => {
  const request = { id: RID, requestNo: "REQ-0001", title: "Patch DB", ownerId: OWNER };
  const members = [
    { userId: OWNER, activityRole: "OWNER", status: "ACTIVE" },
    { userId: PART, activityRole: "PARTICIPANT", status: "ACTIVE" },
    { userId: U(5), activityRole: "APPROVER", status: "ACTIVE" },
    { userId: U(6), activityRole: "PARTICIPANT", status: "REMOVED" },
  ] as const;
  test("every active member except the actor is told; removed members are not; no reason is leaked", () => {
    const plan = planNotifications({ action: "REQUEST_STATUS_CHANGED", actorId: OWNER, actorName: "Owner", toStatus: "CANCELLED", reason: "secret reason" }, request, [...members]);
    assert.deepEqual(plan.map((p) => p.recipientId).sort(), [PART, U(5)].sort());
    assert.ok(plan.every((p) => p.type === "REQUEST_STATUS_CHANGED" && !p.body.includes("secret")));
    assert.match(plan[0].title, /Cancelled/);
  });
});

test("no reserved word is used un-aliased by the lifecycle handlers", async () => {
  seedRequest();
  seedMember(OWNER, "OWNER");
  await move(OWNER, { to: "SCHEDULED", version: 7 });
  await cancel(OWNER, { reason: "x", version: 7 });
  const offenders = db.sent.flatMap((s) => expressionsOf(s.input)).filter((e) => reservedWordsIn(e).length);
  assert.deepEqual(offenders, []);
});
