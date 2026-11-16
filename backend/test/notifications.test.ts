import "./helpers/env";
import { after, afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { marshall } from "@aws-sdk/util-dynamodb";
import { planNotifications, RESERVED_ACTIONS, type MemberLite, type RequestLite } from "../src/lib/notifications";
import { deliverEmail, emailConfigFromEnv, renderEmail, type EmailSender } from "../src/lib/email";
import { handler as notifier, processAudit } from "../src/handlers/notifier";
import { handler as notificationsApi } from "../src/handlers/notifications";
import { encodeToken } from "../src/lib/http";
import { event, expressionsOf, FakeDb, parse, reservedWordsIn, type Sent } from "./helpers/fakeDb";

const U = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SARA = U(2), PART = U(3), OTHER = U(4), GONE = U(6), ADMIN = U(9);
const RID = "01JC0000000000000000000001";
const AUDIT_ID = "01JD00000000000000000000AA";
const request: RequestLite = { id: RID, requestNo: "REQ-0001", title: "Patch DB", ownerId: OWNER };
const m = (userId: string, activityRole: MemberLite["activityRole"], status: MemberLite["status"] = "ACTIVE"): MemberLite => ({ userId, activityRole, status });
const members = [m(OWNER, "OWNER"), m(SARA, "APPROVER"), m(OTHER, "APPROVER"), m(PART, "PARTICIPANT"), m(GONE, "PARTICIPANT", "REMOVED")];
const audit = (action: string, actorId: string, extra: Record<string, unknown> = {}) => ({
  PK: `REQ#${RID}`, SK: `AUDIT#2026-11-12T10:00:00.000Z#${AUDIT_ID}`, entityType: "AUDIT", action, actorId, actorName: actorId.slice(-4), at: "2026-11-12T10:00:00.000Z", ...extra,
});
const who = (action: string, actorId: string, extra: Record<string, unknown> = {}, ms = members) =>
  planNotifications(audit(action, actorId, extra), request, ms).map((p) => `${p.recipientId.slice(-1)}:${p.type}`).sort();

/* ------------------------------------------------------------------ rules: who is notified */
describe("planNotifications: recipients and permissions", () => {
  test("request created by its owner notifies nobody (no self-notifications)", () => {
    assert.deepEqual(who("REQUEST_CREATED", OWNER), []);
  });

  test("member assigned: the new member; the owner only when someone else (an admin) assigned", () => {
    assert.deepEqual(who("APPROVER_ASSIGNED", OWNER, { targetUserId: SARA, targetActivityRole: "APPROVER" }), ["2:MEMBER_ASSIGNED"]);
    assert.deepEqual(who("MEMBER_ADDED", ADMIN, { targetUserId: PART, targetActivityRole: "PARTICIPANT" }), ["1:MEMBER_ASSIGNED", "3:MEMBER_ASSIGNED"]);
    const body = planNotifications(audit("APPROVER_ASSIGNED", OWNER, { targetUserId: SARA, targetActivityRole: "APPROVER" }), request, members)[0].body;
    assert.match(body, /as an approver/);
  });

  test("member removed: the removed person is told once, without a link; never other non-members", () => {
    const plan = planNotifications(audit("MEMBER_REMOVED", OWNER, { targetUserId: GONE, targetName: "Gone" }), request, members);
    assert.deepEqual(plan.map((p) => [p.recipientId, p.type, p.linkToRequest]), [[GONE, "MEMBER_REMOVED", false]]);
  });

  test("submitted: approvers get APPROVAL_REQUIRED, participants REQUEST_SUBMITTED, owner (actor) nothing", () => {
    assert.deepEqual(who("SUBMITTED_FOR_APPROVAL", OWNER, { approvers: [{ userId: SARA }, { userId: OTHER }] }), ["2:APPROVAL_REQUIRED", "3:REQUEST_SUBMITTED", "4:APPROVAL_REQUIRED"]);
    // Submitted by an admin: the owner is told as well.
    assert.ok(who("SUBMITTED_FOR_APPROVAL", ADMIN, { approvers: [{ userId: SARA }] }).includes("1:REQUEST_SUBMITTED"));
  });

  test("decision with the round still open: only the owner", () => {
    assert.deepEqual(who("APPROVAL_DECIDED", SARA, { decision: "REJECTED", resultingRequestStatus: "PENDING_APPROVAL" }), ["1:APPROVAL_DECISION_RECORDED"]);
  });

  test("final decision: owner, participants and other approvers; never the decider or removed members", () => {
    assert.deepEqual(who("APPROVAL_DECIDED", SARA, { decision: "APPROVED", resultingRequestStatus: "APPROVED" }), ["1:REQUEST_APPROVED", "3:REQUEST_APPROVED", "4:REQUEST_APPROVED"]);
    assert.deepEqual(who("APPROVAL_DECIDED", SARA, { decision: "REJECTED", resultingRequestStatus: "REJECTED" }), ["1:REQUEST_REJECTED", "3:REQUEST_REJECTED", "4:REQUEST_REJECTED"]);
  });

  test("withdrawn: approvers whose decisions were closed and participants; owner only if someone else withdrew", () => {
    assert.deepEqual(who("REQUEST_WITHDRAWN", OWNER, { closedRecords: [OTHER] }), ["3:REQUEST_WITHDRAWN", "4:REQUEST_WITHDRAWN"]);
    assert.ok(who("REQUEST_WITHDRAWN", ADMIN, { closedRecords: [] }).includes("1:REQUEST_WITHDRAWN"));
  });

  test("minor field updates and unknown actions notify nobody", () => {
    assert.deepEqual(who("REQUEST_UPDATED", OWNER, { changedFields: ["title"] }), []);
    assert.deepEqual(who("SOMETHING_ELSE", OWNER), []);
  });

  test("activity scope: people named in the audit but not ACTIVE members are never notified", () => {
    // A stale approver list (someone removed before processing) and a platform admin who is not a member.
    assert.deepEqual(who("SUBMITTED_FOR_APPROVAL", OWNER, { approvers: [{ userId: SARA }, { userId: GONE }, { userId: ADMIN }] }), ["2:APPROVAL_REQUIRED", "3:REQUEST_SUBMITTED"]);
    assert.deepEqual(who("TASK_ASSIGNED", OWNER, { assigneeId: ADMIN }), []);
  });

  test("reserved events (features not built yet) have rules", () => {
    assert.deepEqual(who("REQUEST_STATUS_CHANGED", OWNER, { toStatus: "IN_PROGRESS" }), ["2:REQUEST_STATUS_CHANGED", "3:REQUEST_STATUS_CHANGED", "4:REQUEST_STATUS_CHANGED"]);
    assert.deepEqual(who("TASK_ASSIGNED", OWNER, { assigneeId: PART, taskTitle: "Backup" }), ["3:TASK_ASSIGNED"]);
    assert.deepEqual(who("TASK_COMPLETED", PART, { assignedBy: OWNER }), ["1:TASK_COMPLETED"]);
    assert.deepEqual(who("READINESS_UPDATED", PART), ["1:READINESS_UPDATED"]);
    assert.deepEqual(who("MAINTENANCE_COMPLETED", OWNER), ["2:MAINTENANCE_COMPLETED", "3:MAINTENANCE_COMPLETED", "4:MAINTENANCE_COMPLETED"]);
    assert.deepEqual(who("VALIDATION_COMPLETED", PART), ["1:VALIDATION_COMPLETED"]);
    assert.deepEqual(who("FINAL_REPORT_AVAILABLE", OWNER), ["2:FINAL_REPORT_AVAILABLE", "3:FINAL_REPORT_AVAILABLE", "4:FINAL_REPORT_AVAILABLE"]);
    assert.equal(RESERVED_ACTIONS.length, 7);
  });

  test("notifications carry no comments or reasons", () => {
    const all = [
      ...planNotifications(audit("APPROVAL_DECIDED", SARA, { decision: "REJECTED", comment: "SECRET-COMMENT", resultingRequestStatus: "REJECTED" }), request, members),
      ...planNotifications(audit("REQUEST_WITHDRAWN", OWNER, { reason: "SECRET-REASON", closedRecords: [SARA] }), request, members),
    ];
    assert.ok(all.length > 0);
    for (const p of all) assert.doesNotMatch(`${p.title} ${p.body}`, /SECRET/);
  });
});

/* ------------------------------------------------------------------ email: disabled by default */
describe("email delivery", () => {
  const n = { title: "REQ-0001 approved", body: "REQ-0001 – Patch DB was approved.", requestId: RID };
  const spy = () => {
    const sent: unknown[] = [];
    const sender: EmailSender = { send: async (msg) => void sent.push(msg) };
    return { sender, sent };
  };

  test("config: disabled unless EMAIL_ENABLED=true AND EMAIL_FROM is set", () => {
    assert.equal(emailConfigFromEnv({}).enabled, false);
    assert.equal(emailConfigFromEnv({ EMAIL_ENABLED: "true" }).enabled, false);
    assert.equal(emailConfigFromEnv({ EMAIL_ENABLED: "false", EMAIL_FROM: "a@b.c" }).enabled, false);
    assert.equal(emailConfigFromEnv({ EMAIL_ENABLED: "true", EMAIL_FROM: "a@b.c" }).enabled, true);
    assert.equal(emailConfigFromEnv(process.env).enabled, false, "the test/default environment has email off");
  });

  test("disabled: nothing is sent, status DISABLED (even with a sender and an address)", async () => {
    const { sender, sent } = spy();
    assert.equal(await deliverEmail({ enabled: false, from: "", appUrl: "" }, sender, { email: "x@example.test" }, n), "DISABLED");
    assert.equal(sent.length, 0);
  });

  test("enabled: preference off, no address, success and failure", async () => {
    const cfg = { enabled: true, from: "no-reply@example.test", appUrl: "https://app.test" };
    const { sender, sent } = spy();
    assert.equal(await deliverEmail(cfg, sender, { email: "x@example.test", notificationPrefs: { email: false } }, n), "SKIPPED_PREFERENCE");
    assert.equal(await deliverEmail(cfg, sender, {}, n), "SKIPPED_NO_ADDRESS");
    assert.equal(await deliverEmail(cfg, sender, { email: "x@example.test" }, n), "SENT");
    assert.equal(sent.length, 1);
    const failing: EmailSender = { send: async () => { throw new Error("SES down"); } };
    assert.equal(await deliverEmail(cfg, failing, { email: "x@example.test" }, n), "FAILED");
  });

  test("email text links to the request only when the recipient may open it", () => {
    assert.match(renderEmail(n, "https://app.test").text, /https:\/\/app\.test\/requests\/01JC/);
    assert.doesNotMatch(renderEmail({ ...n, requestId: null }, "https://app.test").text, /requests\//);
  });
});

/* ------------------------------------------------------------------ notifier (stream) */
let db: FakeDb;
const allSent: Sent[] = [];
beforeEach(() => {
  db = new FakeDb().install();
});
afterEach(() => {
  allSent.push(...db.sent);
  db.uninstall();
});
const seed = () => {
  db.put({ PK: `REQ#${RID}`, SK: "META", id: RID, requestNo: "REQ-0001", title: "Patch DB", ownerId: OWNER, status: "PENDING_APPROVAL" });
  for (const x of members) db.put({ PK: `REQ#${RID}`, SK: `MEMBER#${x.userId}`, entityType: "MEMBER", ...x });
  for (const id of [OWNER, SARA, OTHER, PART]) db.put({ PK: `USER#${id}`, SK: "PROFILE", userId: id, email: `${id.slice(-4)}@example.test`, notificationPrefs: { email: id !== PART } });
};
const notifs = () => [...db.store.values()].filter((i) => i.entityType === "NOTIFICATION");
const disabled = { enabled: false, from: "", appUrl: "" };

describe("notifier", () => {
  test("writes one in-app notification per recipient; email disabled -> no profile reads, no sending", async () => {
    seed();
    const sent: unknown[] = [];
    const n = await processAudit(audit("SUBMITTED_FOR_APPROVAL", OWNER, { approvers: [{ userId: SARA }, { userId: OTHER }] }), {
      email: disabled,
      sender: { send: async (x) => void sent.push(x) },
    });
    assert.equal(n, 3);
    assert.equal(sent.length, 0, "disabled email never sends, even if a sender exists");
    assert.equal(db.commands("BatchGetCommand").length, 0, "profiles are not read while email is disabled");
    const items = notifs();
    assert.deepEqual(items.map((i) => i.PK).sort(), [`USER#${SARA}`, `USER#${PART}`, `USER#${OTHER}`]);
    for (const i of items) {
      assert.equal(i.SK, `NOTIF#${AUDIT_ID}`);
      assert.equal(i.emailStatus, "DISABLED");
      assert.equal(i.readAt, undefined);
      assert.ok(i.ttl > Date.now() / 1000 + 179 * 86_400);
    }
    for (const s of db.sent.filter((x) => x.name === "GetCommand" || x.name === "QueryCommand")) assert.equal(s.input.ConsistentRead, true);
  });

  test("idempotent: a retried stream record creates no duplicates and keeps read state", async () => {
    seed();
    const a = audit("SUBMITTED_FOR_APPROVAL", OWNER, { approvers: [{ userId: SARA }] });
    assert.equal(await processAudit(a, { email: disabled }), 2);
    db.get(`USER#${SARA}`, `NOTIF#${AUDIT_ID}`)!.readAt = "2026-11-12T11:00:00.000Z";
    assert.equal(await processAudit(a, { email: disabled }), 0);
    assert.equal(notifs().length, 2);
    assert.equal(db.get(`USER#${SARA}`, `NOTIF#${AUDIT_ID}`)!.readAt, "2026-11-12T11:00:00.000Z");
  });

  test("email enabled (injected sender): sends per preference and records the status", async () => {
    seed();
    const sent: { to: string }[] = [];
    await processAudit(audit("APPROVAL_DECIDED", SARA, { decision: "APPROVED", resultingRequestStatus: "APPROVED" }), {
      email: { enabled: true, from: "no-reply@example.test", appUrl: "https://app.test" },
      sender: { send: async (x) => void sent.push(x) },
    });
    assert.deepEqual(sent.map((s) => s.to).sort(), [`${OWNER.slice(-4)}@example.test`, `${OTHER.slice(-4)}@example.test`]);
    assert.equal(db.get(`USER#${PART}`, `NOTIF#${AUDIT_ID}`)!.emailStatus, "SKIPPED_PREFERENCE");
    assert.equal(db.get(`USER#${OWNER}`, `NOTIF#${AUDIT_ID}`)!.emailStatus, "SENT");
  });

  test("ignores non-audit items, other partitions and minor updates", async () => {
    seed();
    assert.equal(await processAudit({ PK: `REQ#${RID}`, SK: "META", entityType: "REQUEST" }, { email: disabled }), 0);
    assert.equal(await processAudit(audit("REQUEST_UPDATED", OWNER), { email: disabled }), 0);
    assert.equal(notifs().length, 0);
  });

  test("stream handler: unmarshalls INSERTs, default config has email off, failures are reported", async () => {
    seed();
    const rec = (seq: string, img: Record<string, unknown>, eventName = "INSERT") => ({ eventName, dynamodb: { SequenceNumber: seq, NewImage: marshall(img, { removeUndefinedValues: true }) } });
    const ok = await notifier({ Records: [rec("1", audit("APPROVER_ASSIGNED", OWNER, { targetUserId: SARA, targetActivityRole: "APPROVER" })), rec("2", audit("REQUEST_UPDATED", OWNER), "MODIFY")] } as any);
    assert.deepEqual(ok.batchItemFailures, []);
    assert.equal(notifs().length, 1);
    assert.equal(notifs()[0].emailStatus, "DISABLED");

    // A database error on the first record: it is reported and processing stops, so it and later records are retried.
    const real = (db as any).handle.bind(db);
    (db as any).handle = async (cmd: any) => {
      if (cmd.constructor.name === "GetCommand") throw new Error("database unavailable");
      return real(cmd);
    };
    const later = { ...audit("APPROVER_ASSIGNED", OWNER, { targetUserId: OTHER }), SK: "AUDIT#2026-11-12T10:01:00.000Z#01JD00000000000000000000AC" };
    const broken = await notifier({ Records: [rec("7", { ...audit("APPROVER_ASSIGNED", OWNER, { targetUserId: SARA }), SK: "AUDIT#2026-11-12T10:00:30.000Z#01JD00000000000000000000AB" }), rec("8", later)] } as any);
    assert.deepEqual(broken.batchItemFailures, [{ itemIdentifier: "7" }]);
  });
});

/* ------------------------------------------------------------------ notifications API */
describe("notifications API (own partition only)", () => {
  const call = (method: string, resource: string, sub: string, opts: { query?: Record<string, string>; path?: Record<string, string> } = {}) =>
    notificationsApi(event({ method, resource, sub, ...opts })).then(parse);
  const seedNotifs = () => {
    db.put({ PK: `USER#${SARA}`, SK: "NOTIF#01JD00000000000000000000A1", entityType: "NOTIFICATION", id: "01JD00000000000000000000A1", title: "one", body: "b", requestId: RID, requestNo: "REQ-0001", linkToRequest: true, createdAt: "2026-11-12T10:00:00Z" });
    db.put({ PK: `USER#${SARA}`, SK: "NOTIF#01JD00000000000000000000A2", entityType: "NOTIFICATION", id: "01JD00000000000000000000A2", title: "two", body: "b", requestId: RID, requestNo: "REQ-0001", linkToRequest: false, createdAt: "2026-11-12T11:00:00Z", readAt: "2026-11-12T12:00:00Z" });
    db.put({ PK: `USER#${OTHER}`, SK: "NOTIF#01JD00000000000000000000B1", entityType: "NOTIFICATION", id: "01JD00000000000000000000B1", title: "other", body: "b", requestId: RID, requestNo: "REQ-0001", linkToRequest: true, createdAt: "2026-11-12T10:00:00Z" });
  };

  test("list: newest first, own items only, unread filter, removal notifications have no link", async () => {
    seedNotifs();
    const all = await call("GET", "/notifications", SARA);
    assert.equal(all.status, 200);
    assert.deepEqual(all.body.items.map((i: any) => i.title), ["two", "one"]);
    assert.equal(all.body.items[0].requestId, null, "linkToRequest=false hides the request id");
    assert.equal(JSON.stringify(all.body).includes("other"), false);
    const unread = await call("GET", "/notifications", SARA, { query: { unread: "true" } });
    assert.deepEqual(unread.body.items.map((i: any) => i.title), ["one"]);
  });

  test("unread count", async () => {
    seedNotifs();
    assert.deepEqual((await call("GET", "/notifications/unread-count", SARA)).body, { count: 1 });
    assert.deepEqual((await call("GET", "/notifications/unread-count", OWNER)).body, { count: 0 });
  });

  test("mark read: own -> 204; someone else's id -> 404 (key is always the caller's partition); bad id -> 404", async () => {
    seedNotifs();
    assert.equal((await call("POST", "/notifications/{notificationId}/read", SARA, { path: { notificationId: "01JD00000000000000000000A1" } })).status, 204);
    assert.ok(db.get(`USER#${SARA}`, "NOTIF#01JD00000000000000000000A1")!.readAt);
    const foreign = await call("POST", "/notifications/{notificationId}/read", SARA, { path: { notificationId: "01JD00000000000000000000B1" } });
    assert.equal(foreign.status, 404);
    assert.equal(db.get(`USER#${OTHER}`, "NOTIF#01JD00000000000000000000B1")!.readAt, undefined, "other user's item untouched");
    assert.equal((await call("POST", "/notifications/{notificationId}/read", SARA, { path: { notificationId: "nope" } })).status, 404);
  });

  test("read-all marks only the caller's unread items", async () => {
    seedNotifs();
    assert.equal((await call("POST", "/notifications/read-all", SARA)).status, 204);
    assert.ok(db.get(`USER#${SARA}`, "NOTIF#01JD00000000000000000000A1")!.readAt);
    assert.equal(db.get(`USER#${SARA}`, "NOTIF#01JD00000000000000000000A2")!.readAt, "2026-11-12T12:00:00Z", "earlier read time kept");
    assert.equal(db.get(`USER#${OTHER}`, "NOTIF#01JD00000000000000000000B1")!.readAt, undefined);
  });

  test("a continuation token for another user's partition -> 400; bad unread flag -> 400", async () => {
    const tok = encodeToken({ PK: `USER#${OTHER}`, SK: "NOTIF#01JD00000000000000000000B1" })!;
    assert.equal((await call("GET", "/notifications", SARA, { query: { nextToken: tok } })).status, 400);
    assert.equal((await call("GET", "/notifications", SARA, { query: { unread: "yes" } })).status, 400);
  });
});

after(() => {
  const offenders = allSent.flatMap((s) => expressionsOf(s.input).map((e) => ({ cmd: s.name, e, bad: reservedWordsIn(e) }))).filter((x) => x.bad.length);
  assert.deepEqual(offenders, [], "no DynamoDB reserved word may appear un-aliased in any expression");
});
