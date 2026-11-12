import "./helpers/env";
import { after, afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { handler as approvals } from "../src/handlers/approvals";
import { handler as members } from "../src/handlers/members";
import { handler as attachments } from "../src/handlers/attachments";
import { handler as users } from "../src/handlers/users";
import { handler as requests } from "../src/handlers/requests";
import { handler as me } from "../src/handlers/me";
import { encodeToken } from "../src/lib/http";
import { event, expressionsOf, FakeDb, parse, reservedWordsIn, type Sent } from "./helpers/fakeDb";

const U = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SARA = U(2), PART = U(3), OTHER = U(4), ADMIN = U(9);
const RID = "01JC0000000000000000000001";
const SUBMITTED = "2026-11-11T00:00:00.000Z";

let db: FakeDb;
const allSent: Sent[] = [];
beforeEach(() => {
  db = new FakeDb().install();
});
afterEach(() => {
  allSent.push(...db.sent);
  db.uninstall();
});

/* ------------------------------------------------------------------ seed helpers */
const seedRequest = (o: Record<string, unknown> = {}) =>
  db.put({
    PK: `REQ#${RID}`, SK: "META", entityType: "REQUEST", id: RID, requestNo: "REQ-0001", title: "Patch DB", description: "Monthly patching",
    status: "DRAFT", approvalState: "NONE", approvalRound: 0, approvalPolicy: "ANY_ONE", ownerId: OWNER, ownerName: "Owner", ownerInitials: "Ow",
    membersRev: 1, createdAt: "2026-11-10T00:00:00.000Z", updatedAt: "2026-11-10T00:00:00.000Z", version: 1, category: "IT", ...o,
  });
const seedMember = (userId: string, activityRole: string, status = "ACTIVE") =>
  db.put({ PK: `REQ#${RID}`, SK: `MEMBER#${userId}`, entityType: "MEMBER", requestId: RID, userId, displayName: userId.slice(-4), initials: "XX", activityRole, status });
const seedProfile = (userId: string, eligible: boolean, name = userId.slice(-4)) => {
  db.put({ PK: `USER#${userId}`, SK: "PROFILE", entityType: "USER", userId, email: `${userId.slice(-4)}@example.test`, displayName: name, initials: "XX", status: "ACTIVE", GSI2PK: "DIRECTORY", GSI2SK: `${name.toLowerCase()}#${userId}` });
  if (eligible) db.put({ PK: `USER#${userId}`, SK: "ROLE#ApprovalEligible", role: "ApprovalEligible", userId, GSI2PK: "ROLE#ApprovalEligible", GSI2SK: `${name.toLowerCase()}#${userId}` });
};
/** A request in its first approval round with the given approvers (all PENDING). */
const seedPending = (policy: "ANY_ONE" | "ALL", approverIds = [SARA, OTHER]) => {
  seedRequest({ status: "PENDING_APPROVAL", approvalState: "PENDING", approvalRound: 1, approvalPolicy: policy, version: 4, membersRev: 3 });
  seedMember(OWNER, "OWNER");
  seedMember(PART, "PARTICIPANT");
  for (const id of approverIds) {
    seedMember(id, "APPROVER");
    db.put({
      PK: `REQ#${RID}`, SK: `APPR#0001#${id}`, entityType: "APPROVAL_RECORD", requestId: RID, round: 1, policy, approverId: id, decision: "PENDING",
      submittedAt: SUBMITTED, GSI3PK: `APPROVER#${id}`, GSI3SK: `PENDING#${SUBMITTED}#${RID}`,
    });
  }
  db.put({ PK: `REQ#${RID}`, SK: "APPRROUND#0001", entityType: "APPROVAL_ROUND", round: 1, policy, status: "OPEN", approverIds });
};

const decide = (sub: string, body: unknown, groups = "ApprovalEligible") =>
  approvals(event({ method: "POST", resource: "/requests/{requestId}/approvals/decision", sub, groups, body, path: { requestId: RID } })).then(parse);

/** The single item of a transaction acting on key PK|SK (Put, Update, Delete or ConditionCheck). */
const txItem = (tx: any[], sk: string, pk = `REQ#${RID}`) =>
  tx.map((t) => Object.values(t)[0] as any).find((p) => (p.Item ?? p.Key)?.PK === pk && (p.Item ?? p.Key)?.SK === sk);

const consistentReads = () =>
  db.sent
    .filter((s) => s.name === "GetCommand" || s.name === "QueryCommand")
    .map((s) => ({ key: s.input.Key ? `${s.input.Key.PK}|${s.input.Key.SK}` : s.input.ExpressionAttributeValues?.[":s"] ?? s.input.ExpressionAttributeValues?.[":m"], consistent: s.input.ConsistentRead === true }));

/* ------------------------------------------------------------------ decide */
describe("POST /requests/{id}/approvals/decision", () => {
  test("C1: reject with comment succeeds and aliases `comment` (ALL: rejection is final)", async () => {
    seedPending("ALL");
    const res = await decide(SARA, { decision: "REJECTED", comment: "Backup plan missing" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.requestStatus, "REJECTED");
    const [tx] = db.transactions();
    const mine = txItem(tx, `APPR#0001#${SARA}`);
    assert.ok(Object.values(mine.ExpressionAttributeNames).includes("comment"));
    assert.deepEqual(reservedWordsIn(mine.UpdateExpression), []);
    assert.equal(Object.values(mine.ExpressionAttributeValues).includes("Backup plan missing"), true);
    assert.equal(txItem(tx, `APPR#0001#${OTHER}`).ExpressionAttributeValues[":dec"], "NOT_REQUIRED");
    assert.equal(txItem(tx, "META").Item.status, "REJECTED");
    assert.equal(txItem(tx, "APPRROUND#0001").ExpressionAttributeValues[":st"], "REJECTED");
    assert.ok(txItem(tx, "STATUS#PENDING_APPROVAL", "STATS#GLOBAL") && txItem(tx, "STATUS#REJECTED", "STATS#GLOBAL"), "status counters moved");
    const audit = tx.map((t) => t.Put?.Item).find((i) => i?.entityType === "AUDIT");
    assert.equal(audit.action, "APPROVAL_DECIDED");
    assert.equal(audit.actorActivityRole, "APPROVER");
  });

  test("C2: decision reads are strongly consistent", async () => {
    seedPending("ANY_ONE");
    await decide(SARA, { decision: "APPROVED" });
    const reads = consistentReads();
    assert.ok(reads.length >= 3);
    for (const r of reads) assert.equal(r.consistent, true, `read ${r.key} must be consistent`);
  });

  test("ANY_ONE: approval with comment completes the round", async () => {
    seedPending("ANY_ONE");
    const res = await decide(SARA, { decision: "APPROVED", comment: "Looks good" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.requestStatus, "APPROVED");
    const [tx] = db.transactions();
    assert.equal(txItem(tx, `APPR#0001#${OTHER}`).ExpressionAttributeValues[":dec"], "NOT_REQUIRED");
  });

  test("ALL: first approval keeps the round open (no counters, no round close)", async () => {
    seedPending("ALL");
    const res = await decide(SARA, { decision: "APPROVED" });
    assert.equal(res.body.requestStatus, "PENDING_APPROVAL");
    const [tx] = db.transactions();
    assert.equal(txItem(tx, "APPRROUND#0001"), undefined);
    assert.equal(tx.filter((t) => t.Update?.Key?.PK === "STATS#GLOBAL").length, 0);
    assert.equal(txItem(tx, "META").ConditionExpression.includes("#v = :v"), true, "version still bumped to serialise decisions");
  });

  test("ALL: last approval completes the round", async () => {
    seedPending("ALL");
    const rec = db.get(`REQ#${RID}`, `APPR#0001#${OTHER}`)!;
    db.put({ ...rec, decision: "APPROVED" });
    const res = await decide(SARA, { decision: "APPROVED" });
    assert.equal(res.body.requestStatus, "APPROVED");
  });

  test("concurrent decision: retried, then succeeds", async () => {
    seedPending("ALL");
    db.failNextTransactions = 1;
    const res = await decide(SARA, { decision: "APPROVED" });
    assert.equal(res.status, 200);
    assert.equal(db.transactions().length, 2);
  });

  test("concurrent decision: gives up after 3 attempts with 409", async () => {
    seedPending("ALL");
    db.failNextTransactions = 3;
    const res = await decide(SARA, { decision: "APPROVED" });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, "CONCURRENT_UPDATE");
  });

  test("owner, participant and unassigned admin cannot decide", async () => {
    seedPending("ANY_ONE");
    assert.equal((await decide(OWNER, { decision: "APPROVED" })).body.error.code, "SELF_APPROVAL");
    assert.equal((await decide(PART, { decision: "APPROVED" })).body.error.code, "SELF_APPROVAL");
    assert.equal((await decide(ADMIN, { decision: "APPROVED" }, "PlatformAdmin,ApprovalEligible")).body.error.code, "NOT_ASSIGNED");
    assert.equal((await decide(SARA, { decision: "APPROVED" }, "")).body.error.code, "NOT_ELIGIBLE");
    assert.equal(db.transactions().length, 0);
  });
});

/* ------------------------------------------------------------------ ANY_ONE mixed decisions */
describe("ANY_ONE: one approval is sufficient, rejection only when everyone rejected", () => {
  const THIRD = U(5);
  const setRecord = (id: string, decision: string, extra: Record<string, unknown> = {}) => {
    const rec = db.get(`REQ#${RID}`, `APPR#0001#${id}`)!;
    db.put({ ...rec, decision, GSI3SK: `${decision}#${SUBMITTED}#${RID}`, ...extra });
  };
  const bumpRequest = (changes: Record<string, unknown>) => {
    const r = db.get(`REQ#${RID}`, "META")!;
    db.put({ ...r, ...changes, version: r.version + 1 });
  };

  test("rejection with others pending keeps the request PENDING_APPROVAL", async () => {
    seedPending("ANY_ONE", [SARA, OTHER, THIRD]);
    const res = await decide(SARA, { decision: "REJECTED", comment: "Rollback plan missing" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.requestStatus, "PENDING_APPROVAL");
    assert.equal(res.body.roundStatus, "OPEN");
    const [tx] = db.transactions();
    const req = txItem(tx, "META");
    assert.equal(req.Item.status, "PENDING_APPROVAL");
    assert.equal(req.Item.version, 5, "version bumped to serialise concurrent decisions");
    assert.equal(req.ExpressionAttributeValues[":v"], 4);
    const mine = txItem(tx, `APPR#0001#${SARA}`);
    assert.equal(mine.ExpressionAttributeValues[":dec"], "REJECTED");
    assert.ok(Object.values(mine.ExpressionAttributeNames).includes("comment"));
    assert.equal(txItem(tx, `APPR#0001#${OTHER}`), undefined, "other approvers stay PENDING");
    assert.equal(txItem(tx, `APPR#0001#${THIRD}`), undefined);
    assert.equal(txItem(tx, "APPRROUND#0001"), undefined, "round stays OPEN");
    assert.equal(tx.filter((t) => t.Update?.Key?.PK === "STATS#GLOBAL").length, 0, "no status change, no counters");
    const audit = tx.map((t) => t.Put?.Item).find((i) => i?.entityType === "AUDIT");
    assert.equal(audit.decision, "REJECTED");
    assert.equal(audit.resultingRequestStatus, "PENDING_APPROVAL");
  });

  test("approval after an earlier rejection approves; only PENDING records close, the rejection stays", async () => {
    seedPending("ANY_ONE", [SARA, OTHER, THIRD]);
    setRecord(SARA, "REJECTED", { comment: "No" });
    const res = await decide(OTHER, { decision: "APPROVED", comment: "Fine after review" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.requestStatus, "APPROVED");
    const [tx] = db.transactions();
    assert.equal(txItem(tx, "META").Item.status, "APPROVED");
    assert.equal(txItem(tx, `APPR#0001#${SARA}`), undefined, "the existing rejection is not rewritten");
    const third = txItem(tx, `APPR#0001#${THIRD}`);
    assert.equal(third.ExpressionAttributeValues[":dec"], "NOT_REQUIRED");
    assert.ok(Object.values(third.ExpressionAttributeValues).includes("APPROVED_BY_OTHER"));
    assert.equal(txItem(tx, "APPRROUND#0001").ExpressionAttributeValues[":st"], "APPROVED");
    assert.ok(txItem(tx, "STATUS#APPROVED", "STATS#GLOBAL"));
  });

  test("last rejection when all others already rejected rejects the request", async () => {
    seedPending("ANY_ONE", [SARA, OTHER, THIRD]);
    setRecord(OTHER, "REJECTED", { comment: "No" });
    setRecord(THIRD, "REJECTED", { comment: "No" });
    const res = await decide(SARA, { decision: "REJECTED", comment: "Agree, no" });
    assert.equal(res.body.requestStatus, "REJECTED");
    const [tx] = db.transactions();
    assert.equal(txItem(tx, "META").Item.status, "REJECTED");
    assert.equal(txItem(tx, `APPR#0001#${OTHER}`), undefined);
    assert.equal(txItem(tx, `APPR#0001#${THIRD}`), undefined);
    assert.equal(txItem(tx, "APPRROUND#0001").ExpressionAttributeValues[":st"], "REJECTED");
    assert.ok(txItem(tx, "STATUS#REJECTED", "STATS#GLOBAL"));
  });

  test("single approver: rejection is final", async () => {
    seedPending("ANY_ONE", [SARA]);
    assert.equal((await decide(SARA, { decision: "REJECTED", comment: "No" })).body.requestStatus, "REJECTED");
  });

  test("an approver who already rejected cannot decide again (409 ALREADY_DECIDED)", async () => {
    seedPending("ANY_ONE", [SARA, OTHER]);
    setRecord(SARA, "REJECTED", { comment: "No" });
    const res = await decide(SARA, { decision: "APPROVED" });
    assert.equal(res.body.error.code, "ALREADY_DECIDED");
    assert.equal(db.transactions().length, 0);
  });

  test("concurrency: the other approver rejects between read and write -> retry sees it and rejects the request", async () => {
    seedPending("ANY_ONE", [SARA, OTHER]);
    db.failNextTransactions = 1;
    db.onTransaction = (n) => {
      if (n === 1) {
        // OTHER's rejection commits first: their record and the request version change.
        setRecord(OTHER, "REJECTED", { comment: "No" });
        bumpRequest({});
      }
    };
    const res = await decide(SARA, { decision: "REJECTED", comment: "No" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.requestStatus, "REJECTED", "the last rejection must not leave the request pending");
    const txs = db.transactions();
    assert.equal(txs.length, 2);
    assert.equal(txItem(txs[0], "META").Item.status, "PENDING_APPROVAL", "first attempt computed a non-final outcome");
    assert.equal(txItem(txs[1], "META").ExpressionAttributeValues[":v"], 5, "retry uses the fresh version");
    assert.equal(txItem(txs[1], "META").Item.status, "REJECTED");
  });

  test("concurrency: the other approver approves between read and write -> rejection gets 409 NOT_PENDING", async () => {
    seedPending("ANY_ONE", [SARA, OTHER]);
    db.failNextTransactions = 1;
    db.onTransaction = (n) => {
      if (n === 1) {
        setRecord(OTHER, "APPROVED");
        setRecord(SARA, "NOT_REQUIRED", { closedReason: "APPROVED_BY_OTHER" });
        bumpRequest({ status: "APPROVED", approvalState: "APPROVED" });
      }
    };
    const res = await decide(SARA, { decision: "REJECTED", comment: "No" });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, "NOT_PENDING");
    assert.equal(db.transactions().length, 1, "no second write after the request was approved");
  });

  test("concurrency: an approval racing a rejection -> retry still approves", async () => {
    seedPending("ANY_ONE", [SARA, OTHER]);
    db.failNextTransactions = 1;
    db.onTransaction = (n) => {
      if (n === 1) {
        setRecord(OTHER, "REJECTED", { comment: "No" });
        bumpRequest({});
      }
    };
    const res = await decide(SARA, { decision: "APPROVED" });
    assert.equal(res.body.requestStatus, "APPROVED");
    const second = db.transactions()[1];
    assert.equal(txItem(second, `APPR#0001#${OTHER}`), undefined, "the concurrent rejection is preserved");
  });

  test("inbox: a rejecter sees their decision under REJECTED while the request is still pending", async () => {
    seedPending("ANY_ONE", [SARA, OTHER]);
    setRecord(SARA, "REJECTED", { comment: "No" });
    const res = parse(await approvals(event({ method: "GET", resource: "/approvals", sub: SARA, groups: "ApprovalEligible", query: { decision: "REJECTED" } })));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].requestStatus, "PENDING_APPROVAL");
    assert.equal(res.body.items[0].canDecide, false);
    const pending = parse(await approvals(event({ method: "GET", resource: "/approvals", sub: OTHER, groups: "ApprovalEligible" })));
    assert.equal(pending.body.items[0].canDecide, true, "the remaining approver can still decide");
  });
});

describe("ALL: concurrency", () => {
  test("two last approvals racing -> retry completes the round", async () => {
    seedPending("ALL", [SARA, OTHER]);
    db.failNextTransactions = 1;
    db.onTransaction = (n) => {
      if (n === 1) {
        const rec = db.get(`REQ#${RID}`, `APPR#0001#${OTHER}`)!;
        db.put({ ...rec, decision: "APPROVED" });
        const r = db.get(`REQ#${RID}`, "META")!;
        db.put({ ...r, version: r.version + 1 });
      }
    };
    const res = await decide(SARA, { decision: "APPROVED" });
    assert.equal(res.body.requestStatus, "APPROVED");
    assert.equal(txItem(db.transactions()[0], "META").Item.status, "PENDING_APPROVAL");
    assert.equal(txItem(db.transactions()[1], "META").Item.status, "APPROVED");
  });
});

/* ------------------------------------------------------------------ withdraw */
describe("POST /requests/{id}/withdraw", () => {
  const withdraw = (sub: string, body: unknown, groups = "") =>
    approvals(event({ method: "POST", resource: "/requests/{requestId}/withdraw", sub, groups, body, path: { requestId: RID } })).then(parse);

  test("owner withdraws: DRAFT, round WITHDRAWN, pending records NOT_REQUIRED", async () => {
    seedPending("ALL");
    const res = await withdraw(OWNER, { reason: "Approver left the company", version: 4 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, "DRAFT");
    const [tx] = db.transactions();
    const req = txItem(tx, "META");
    assert.equal(req.Item.status, "DRAFT");
    assert.equal(req.Item.approvalState, "WITHDRAWN");
    assert.equal(req.Item.GSI3PK, undefined, "drafts leave the schedule index");
    assert.equal(txItem(tx, "APPRROUND#0001").ExpressionAttributeValues[":w"], "WITHDRAWN");
    for (const id of [SARA, OTHER]) {
      const u = txItem(tx, `APPR#0001#${id}`);
      assert.equal(u.ExpressionAttributeValues[":dec"], "NOT_REQUIRED");
      assert.ok(Object.values(u.ExpressionAttributeValues).includes("WITHDRAWN"));
    }
    assert.ok(txItem(tx, "STATUS#DRAFT", "STATS#GLOBAL"));
    for (const r of consistentReads()) assert.equal(r.consistent, true, `read ${r.key} must be consistent`);
  });

  test("approvers cannot withdraw; reason and version are required; stale version -> 409", async () => {
    seedPending("ANY_ONE");
    assert.equal((await withdraw(SARA, { reason: "x", version: 4 }, "ApprovalEligible")).body.error.code, "FORBIDDEN");
    assert.equal((await withdraw(OWNER, { version: 4 })).status, 400);
    assert.equal((await withdraw(OWNER, { reason: "x", version: 3 })).body.error.code, "VERSION_CONFLICT");
    assert.equal(db.transactions().length, 0);
  });
});

/* ------------------------------------------------------------------ submit */
describe("POST /requests/{id}/submit", () => {
  const submit = (sub: string, body: unknown) =>
    approvals(event({ method: "POST", resource: "/requests/{requestId}/submit", sub, body, path: { requestId: RID } })).then(parse);

  test("snapshots approvers into a new round with consistent reads and membersRev condition", async () => {
    seedRequest({ status: "REJECTED", approvalRound: 1, version: 6, membersRev: 5, approvalDecidedAt: "2026-11-11T05:00:00.000Z" });
    seedMember(OWNER, "OWNER");
    seedMember(SARA, "APPROVER");
    seedProfile(SARA, true);
    const res = await submit(OWNER, { version: 6 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.approvalRound, 2);
    const [tx] = db.transactions();
    const req = txItem(tx, "META");
    assert.equal(req.Item.status, "PENDING_APPROVAL");
    assert.equal("approvalDecidedAt" in req.Item, false, "previous round outcome cleared");
    assert.match(req.ConditionExpression, /membersRev = :mr/);
    assert.equal(req.ExpressionAttributeValues[":mr"], 5);
    const rec = txItem(tx, `APPR#0002#${SARA}`);
    assert.equal(rec.Item.decision, "PENDING");
    assert.equal(rec.Item.GSI3PK, `APPROVER#${SARA}`);
    assert.ok(txItem(tx, "APPRROUND#0002"));
    for (const r of consistentReads()) assert.equal(r.consistent, true, `read ${r.key} must be consistent`);
  });

  test("no approvers -> 400; ineligible approver -> 409", async () => {
    seedRequest();
    seedMember(OWNER, "OWNER");
    assert.equal((await submit(OWNER, { version: 1 })).body.error.code, "NO_APPROVERS");
    seedMember(SARA, "APPROVER");
    seedProfile(SARA, false);
    assert.equal((await submit(OWNER, { version: 1 })).body.error.code, "APPROVER_INVALID");
  });
});

/* ------------------------------------------------------------------ members */
describe("members", () => {
  const add = (sub: string, body: unknown, groups = "") =>
    members(event({ method: "POST", resource: "/requests/{requestId}/members", sub, groups, body, path: { requestId: RID } })).then(parse);

  test("owner assigns an eligible approver", async () => {
    seedRequest();
    seedMember(OWNER, "OWNER");
    seedProfile(SARA, true);
    const res = await add(OWNER, { userId: SARA, activityRole: "APPROVER" });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const [tx] = db.transactions();
    assert.equal(txItem(tx, `MEMBER#${SARA}`).Item.GSI1PK, `MEMBER#${SARA}`);
    assert.match(txItem(tx, "META").UpdateExpression, /membersRev/);
  });

  test("admin cannot assign themselves; owner cannot add participant as approver", async () => {
    seedRequest();
    seedMember(OWNER, "OWNER");
    seedProfile(ADMIN, true);
    seedProfile(PART, true);
    seedMember(PART, "PARTICIPANT");
    assert.equal((await add(ADMIN, { userId: ADMIN, activityRole: "APPROVER" }, "PlatformAdmin,ApprovalEligible")).body.error.code, "SELF_ASSIGNMENT_FORBIDDEN");
    assert.equal((await add(OWNER, { userId: PART, activityRole: "APPROVER" })).body.error.code, "ROLE_CONFLICT");
  });
});

/* ------------------------------------------------------------------ attachments lock */
describe("attachments are locked during approval", () => {
  test("upload and delete -> 409 ATTACHMENTS_LOCKED while pending", async () => {
    seedPending("ANY_ONE");
    const up = parse(await attachments(event({ method: "POST", resource: "/requests/{requestId}/attachments", sub: OWNER, path: { requestId: RID }, body: { fileName: "plan.pdf", contentType: "application/pdf", sizeBytes: 10 } })));
    assert.equal(up.body.error.code, "ATTACHMENTS_LOCKED");
    db.put({ PK: `REQ#${RID}`, SK: "ATT#01JC00000000000000000000AA", id: "01JC00000000000000000000AA", uploadedBy: OWNER, status: "AVAILABLE", s3Key: "k" });
    const del = parse(await attachments(event({ method: "DELETE", resource: "/requests/{requestId}/attachments/{attachmentId}", sub: OWNER, path: { requestId: RID, attachmentId: "01JC00000000000000000000AA" } })));
    assert.equal(del.body.error.code, "ATTACHMENTS_LOCKED");
    assert.equal(db.transactions().length, 0);
  });

  test("upload in DRAFT carries the status check inside the transaction", async () => {
    seedRequest();
    seedMember(OWNER, "OWNER");
    const up = parse(await attachments(event({ method: "POST", resource: "/requests/{requestId}/attachments", sub: OWNER, path: { requestId: RID }, body: { fileName: "plan.pdf", contentType: "application/pdf", sizeBytes: 10 } })));
    assert.equal(up.status, 201, JSON.stringify(up.body));
    const [tx] = db.transactions();
    assert.ok(tx.some((t) => t.ConditionCheck?.Key?.SK === "META"));
  });
});

/* ------------------------------------------------------------------ directory privacy */
describe("GET /users", () => {
  const search = (query: Record<string, string>) => users(event({ method: "GET", resource: "/users", sub: OWNER, query })).then(parse);

  test("q must be at least 2 characters", async () => {
    assert.equal((await search({ q: "s" })).status, 400);
    assert.equal((await search({})).status, 400);
  });

  test("results never contain email addresses", async () => {
    seedProfile(SARA, true, "Sara");
    const res = await search({ q: "sa", approverEligible: "true" });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.items, [{ id: SARA, displayName: "Sara", initials: "XX", approvalEligible: true }]);
    const byEmail = await search({ q: `${SARA.slice(-4)}@example.test` });
    assert.equal(JSON.stringify(byEmail.body).includes("@"), false, "email lookup does not echo the address");
  });

  test("a continuation key from another partition -> 400", async () => {
    const res = await search({ q: "sa", nextToken: encodeToken({ GSI2PK: "ROLE#PlatformAdmin", GSI2SK: "x", PK: "a", SK: "b" })! });
    assert.equal(res.status, 400);
  });
});

/* ------------------------------------------------------------------ continuation tokens */
describe("nextToken partition checks", () => {
  test("inbox token of another approver -> 400", async () => {
    const tok = encodeToken({ GSI3PK: `APPROVER#${OTHER}`, GSI3SK: `PENDING#x#y`, PK: "a", SK: "b" })!;
    const res = parse(await approvals(event({ method: "GET", resource: "/approvals", sub: SARA, query: { nextToken: tok } })));
    assert.equal(res.status, 400);
  });

  test("requests token of another user's memberships -> 400", async () => {
    const tok = encodeToken({ i: 0, k: { GSI1PK: `MEMBER#${OTHER}`, GSI1SK: "x", PK: "a", SK: "b" } } as any)!;
    const res = parse(await requests(event({ method: "GET", resource: "/requests", sub: SARA, query: { nextToken: tok } })));
    assert.equal(res.status, 400);
  });
});

/* ------------------------------------------------------------------ group mirror writes */
describe("GET /me", () => {
  test("I6: unprocessed batch writes are retried", async () => {
    db.unprocessedBatchWrites = 1;
    const res = parse(await me(event({ method: "GET", resource: "/me", sub: SARA, groups: "ApprovalEligible", name: "Sara" })));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(db.commands("BatchWriteCommand").length, 2);
    assert.ok(db.get(`USER#${SARA}`, "ROLE#ApprovalEligible"), "mirror item written on retry");
  });
});

/* ------------------------------------------------------------------ global lint */
after(() => {
  const offenders = allSent.flatMap((s) => expressionsOf(s.input).map((e) => ({ cmd: s.name, e, bad: reservedWordsIn(e) }))).filter((x) => x.bad.length);
  assert.deepEqual(offenders, [], "no DynamoDB reserved word may appear un-aliased in any expression sent by the handlers");
});
