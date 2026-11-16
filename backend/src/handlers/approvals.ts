import { initialsOf } from "../lib/auth";
import {
  authorizeDecision,
  canDecide,
  computeOutcome,
  DECISIONS,
  decisionRecordUpdate,
  inboxSK,
  parseDecisionBody,
  parseWithdrawBody,
  policyOf,
  recordKey,
  roundKey,
  roundStr,
  validateSubmit,
  validateWithdraw,
  type Decision,
} from "../lib/approvals";
import { auditItem } from "../lib/audit";
import { batchGet, queryAll, queryCount, queryPage, TABLE, transact, txConditionFailed, type Item, type TransactItem } from "../lib/db";
import { badRequest, conflict } from "../lib/errors";
import { assertTokenPartition, decodeToken, encodeToken, json, parseLimit, router, type Ctx } from "../lib/http";
import { assertView, getMember, isActive, listMembers, memberKey } from "../lib/members";
import { indexAttrs, loadRequest, reqKey } from "../lib/requests";
import { statsOnStatusChange } from "../lib/stats";
import { loadUserFacts } from "../lib/users";

/** Copy of a request item with new attributes and recomputed index keys (status/schedule indexes). */
/** `changes` values of `undefined` REMOVE the attribute (explicitly, not relying on the marshaller). */
const nextRequest = (r: Item, changes: Item): Item => {
  const { GSI1PK, GSI1SK, GSI2PK, GSI2SK, GSI3PK, GSI3SK, ...base } = r;
  const n: Item = { ...base, ...changes, updatedAt: new Date().toISOString(), version: r.version + 1 };
  for (const [k, v] of Object.entries(changes)) if (v === undefined) delete n[k];
  return { ...n, ...indexAttrs(n) };
};

/** Strongly consistent: the records decide the outcome (review finding C2). */
const roundRecords = (requestId: string, round: number) =>
  queryAll({
    KeyConditionExpression: "PK = :p AND begins_with(SK, :s)",
    ExpressionAttributeValues: { ":p": `REQ#${requestId}`, ":s": `APPR#${roundStr(round)}#` },
    ConsistentRead: true,
  });

const CONSISTENT = { consistent: true } as const;

/* ------------------------------------------------------------------ POST /requests/{id}/submit */
const submit = async ({ caller, path, body }: Ctx) => {
  if (typeof body.version !== "number" || !Number.isInteger(body.version)) {
    throw badRequest("version is required", [{ field: "version", issue: "required" }]);
  }
  // Strongly consistent: the approver snapshot must match the membersRev the transaction checks (finding C2).
  const r = await loadRequest(path.requestId, CONSISTENT);
  const access = await assertView(r, caller, CONSISTENT);
  if (body.version !== r.version) throw conflict("VERSION_CONFLICT", "The request was changed by someone else. Reload and try again.");

  const approverMembers = (await listMembers(r.id, CONSISTENT)).filter((m) => isActive(m) && m.activityRole === "APPROVER");
  const facts = await loadUserFacts(approverMembers.map((m) => m.userId));
  validateSubmit({
    canEdit: access.canEdit,
    request: r,
    approvers: approverMembers.map((m) => ({ member: m, profileActive: !!facts.get(m.userId)?.active, eligible: !!facts.get(m.userId)?.eligible })),
  });

  const now = new Date().toISOString();
  const round = (r.approvalRound ?? 0) + 1;
  const policy = policyOf(r);
  const actor = { userId: caller.userId, displayName: caller.displayName, activityRole: access.auditRole };
  const next = nextRequest(r, {
    status: "PENDING_APPROVAL",
    approvalState: "PENDING",
    approvalRound: round,
    approvalPolicy: policy,
    submittedAt: now,
    submittedBy: caller.userId,
    // Clear the previous round's outcome fields (undefined attributes are dropped by the Put).
    approvalDecidedAt: undefined,
    withdrawnAt: undefined,
    withdrawnBy: undefined,
    withdrawReason: undefined,
  });

  // The membership revision must be unchanged since we read the approvers, so the snapshot is exact.
  const revCondition = r.membersRev === undefined ? "attribute_not_exists(membersRev)" : "membersRev = :mr";
  const records: Item[] = approverMembers.map((m) => ({
    ...recordKey(r.id, round, m.userId),
    entityType: "APPROVAL_RECORD",
    requestId: r.id,
    round,
    policy,
    approverId: m.userId,
    approverName: m.displayName,
    approverInitials: m.initials,
    activityRole: "APPROVER",
    decision: "PENDING",
    submittedAt: now,
    submittedBy: caller.userId,
    submittedByName: caller.displayName,
    // Snapshot for the approver's inbox (the request can change in later rounds).
    requestNo: r.requestNo,
    title: r.title,
    description: String(r.description ?? "").slice(0, 300),
    category: r.category,
    priority: r.priority,
    requestedBy: { id: r.ownerId, displayName: r.ownerName, initials: r.ownerInitials },
    GSI3PK: `APPROVER#${m.userId}`,
    GSI3SK: inboxSK("PENDING", now, r.id),
  }));

  const items: TransactItem[] = [
    {
      Put: {
        TableName: TABLE,
        Item: next,
        ConditionExpression: `#v = :v AND #s IN (:d, :rj) AND ${revCondition}`,
        ExpressionAttributeNames: { "#v": "version", "#s": "status" },
        ExpressionAttributeValues: { ":v": r.version, ":d": "DRAFT", ":rj": "REJECTED", ...(r.membersRev === undefined ? {} : { ":mr": r.membersRev }) },
      },
    },
    {
      Put: {
        TableName: TABLE,
        Item: {
          ...roundKey(r.id, round),
          entityType: "APPROVAL_ROUND",
          requestId: r.id,
          round,
          policy,
          status: "OPEN",
          approverIds: approverMembers.map((m) => m.userId),
          approverCount: approverMembers.length,
          submittedAt: now,
          submittedBy: caller.userId,
          submittedByName: caller.displayName,
          submittedByRole: access.auditRole,
        },
        ConditionExpression: "attribute_not_exists(PK)",
      },
    },
    ...records.map((Item) => ({ Put: { TableName: TABLE, Item, ConditionExpression: "attribute_not_exists(PK)" } })),
    {
      Put: {
        TableName: TABLE,
        Item: auditItem(r.id, actor, "SUBMITTED_FOR_APPROVAL", {
          round,
          policy,
          approvers: approverMembers.map((m) => ({ userId: m.userId, displayName: m.displayName })),
        }),
      },
    },
    ...statsOnStatusChange(r.status, "PENDING_APPROVAL"),
  ];
  try {
    await transact(items);
  } catch (e) {
    if (txConditionFailed(e)) throw conflict("CONCURRENT_UPDATE", "The request or its approvers changed while submitting. Reload and try again.");
    throw e;
  }
  return json(200, { requestId: r.id, status: next.status, approvalRound: round, approvalPolicy: policy, approvers: records.length, version: next.version });
};

/* ------------------------------------------------------------------ POST /requests/{id}/approvals/decision */
const MAX_ATTEMPTS = 3;

/**
 * Decisions are serialised per request: every decision rewrites the request with a version condition.
 * Two approvers deciding at once (important for ALL) cannot both "see the other as pending": the second
 * transaction fails and is retried here with fresh data, so the last approval reliably completes the round.
 * The client does not need to send a version; all rules are re-checked on every attempt.
 */
const decide = async ({ caller, path, body }: Ctx) => {
  const { decision, comment } = parseDecisionBody(body);
  for (let attempt = 1; ; attempt++) {
    // Strongly consistent reads (finding C2). Otherwise, under ALL, a fresh request version combined with
    // stale records could commit a non-final decision after every approver had approved.
    const r = await loadRequest(path.requestId, CONSISTENT);
    // Non-members get 404 like any other request they cannot see.
    await assertView(r, caller, CONSISTENT);
    const round: number = r.approvalRound ?? 0;
    const [member, records] = await Promise.all([
      getMember(r.id, caller.userId, CONSISTENT),
      round ? roundRecords(r.id, round) : Promise.resolve([] as Item[]),
    ]);
    const record = records.find((x) => x.approverId === caller.userId);
    authorizeDecision({ caller, request: r, member, record });

    const policy = policyOf(r);
    const outcome = computeOutcome(policy, decision, caller.userId, records);
    const now = new Date().toISOString();
    const final = outcome.requestStatus !== "PENDING_APPROVAL";
    const next = nextRequest(
      r,
      final
        ? { status: outcome.requestStatus, approvalState: outcome.requestStatus, approvalDecidedAt: now }
        : {}, // not final (ALL approval with others pending, or ANY_ONE rejection with others pending):
              // version bump only. This serialises concurrent decisions so the last one sees all others.
    );

    const setDecision = (approverId: string, d: Decision, extra: Record<string, unknown>): TransactItem => {
      const rec = records.find((x) => x.approverId === approverId)!;
      // All attribute names aliased: `comment` is a DynamoDB reserved word (finding C1).
      return { Update: decisionRecordUpdate({ requestId: r.id, round, approverId, submittedAt: rec.submittedAt, decision: d, now, extra }) };
    };

    const items: TransactItem[] = [
      {
        Put: {
          TableName: TABLE,
          Item: next,
          ConditionExpression: "#v = :v AND #s = :p AND approvalRound = :round",
          ExpressionAttributeNames: { "#v": "version", "#s": "status" },
          ExpressionAttributeValues: { ":v": r.version, ":p": "PENDING_APPROVAL", ":round": round },
        },
      },
      setDecision(caller.userId, decision, {
        comment,
        decidedBy: caller.userId,
        decidedByName: caller.displayName,
        decidedByInitials: initialsOf(caller.displayName),
      }),
      // Only final outcomes close other records: ANY_ONE approval -> APPROVED_BY_OTHER, ALL rejection -> REJECTED_BY_OTHER.
      ...outcome.closeOthers.map((id) =>
        setDecision(id, "NOT_REQUIRED", {
          closedBy: caller.userId,
          closedReason: outcome.requestStatus === "REJECTED" ? "REJECTED_BY_OTHER" : "APPROVED_BY_OTHER",
        }),
      ),
      ...(final
        ? [
            {
              Update: {
                TableName: TABLE,
                Key: roundKey(r.id, round),
                UpdateExpression: "SET #s = :st, decidedAt = :now, decidedBy = :by",
                ConditionExpression: "#s = :open",
                ExpressionAttributeNames: { "#s": "status" },
                ExpressionAttributeValues: { ":st": outcome.roundStatus, ":now": now, ":by": caller.userId, ":open": "OPEN" },
              },
            } as TransactItem,
          ]
        : []),
      {
        Put: {
          TableName: TABLE,
          Item: auditItem(r.id, { userId: caller.userId, displayName: caller.displayName, activityRole: "APPROVER" }, "APPROVAL_DECIDED", {
            round,
            policy,
            decision,
            comment,
            closedOthers: outcome.closeOthers,
            resultingRequestStatus: outcome.requestStatus,
          }),
        },
      },
      ...(final ? statsOnStatusChange("PENDING_APPROVAL", outcome.requestStatus) : []),
    ];

    try {
      await transact(items);
      return json(200, {
        requestId: r.id,
        round,
        decision,
        requestStatus: outcome.requestStatus,
        roundStatus: outcome.roundStatus,
        version: next.version,
      });
    } catch (e) {
      if (!txConditionFailed(e)) throw e;
      if (attempt >= MAX_ATTEMPTS) throw conflict("CONCURRENT_UPDATE", "Other decisions were made at the same time. Reload and try again.");
      // Someone else changed the request or a record in between: re-read and re-check everything.
    }
  }
};

/* ------------------------------------------------------------------ POST /requests/{id}/withdraw */
/**
 * Recovery for an approval round that cannot finish (approver left, lost eligibility, never answers).
 * Owner or platform admin; request returns to DRAFT so approvers can be changed and resubmitted (new round).
 * The open round is closed as WITHDRAWN; nothing in it is reassigned or edited silently.
 * Transaction: request + round + pending records (<= MAX_APPROVERS) + audit + 2 stats  <= 25 items.
 */
const withdraw = async ({ caller, path, body }: Ctx) => {
  const { reason, version } = parseWithdrawBody(body);
  const r = await loadRequest(path.requestId, CONSISTENT);
  const access = await assertView(r, caller, CONSISTENT);
  validateWithdraw({ canEdit: access.canEdit, request: r });
  if (version !== r.version) throw conflict("VERSION_CONFLICT", "The request was changed by someone else. Reload and try again.");

  const round: number = r.approvalRound ?? 0;
  const records = await roundRecords(r.id, round);
  const pending = records.filter((x) => x.decision === "PENDING");
  const now = new Date().toISOString();
  const next = nextRequest(r, {
    status: "DRAFT",
    approvalState: "WITHDRAWN",
    withdrawnAt: now,
    withdrawnBy: caller.userId,
    withdrawReason: reason,
  });

  const items: TransactItem[] = [
    {
      Put: {
        TableName: TABLE,
        Item: next,
        ConditionExpression: "#v = :v AND #s = :p AND approvalRound = :round",
        ExpressionAttributeNames: { "#v": "version", "#s": "status" },
        ExpressionAttributeValues: { ":v": r.version, ":p": "PENDING_APPROVAL", ":round": round },
      },
    },
    {
      Update: {
        TableName: TABLE,
        Key: roundKey(r.id, round),
        UpdateExpression: "SET #s = :w, #at = :now, #by = :by, #why = :why",
        ConditionExpression: "#s = :open",
        ExpressionAttributeNames: { "#s": "status", "#at": "decidedAt", "#by": "decidedBy", "#why": "withdrawReason" },
        ExpressionAttributeValues: { ":w": "WITHDRAWN", ":now": now, ":by": caller.userId, ":why": reason, ":open": "OPEN" },
      },
    },
    ...pending.map(
      (x): TransactItem => ({
        Update: decisionRecordUpdate({
          requestId: r.id,
          round,
          approverId: x.approverId,
          submittedAt: x.submittedAt,
          decision: "NOT_REQUIRED",
          now,
          extra: { closedBy: caller.userId, closedReason: "WITHDRAWN" },
        }),
      }),
    ),
    {
      Put: {
        TableName: TABLE,
        Item: auditItem(r.id, { userId: caller.userId, displayName: caller.displayName, activityRole: access.auditRole }, "REQUEST_WITHDRAWN", {
          round,
          reason,
          closedRecords: pending.map((x) => x.approverId),
        }),
      },
    },
    ...statsOnStatusChange("PENDING_APPROVAL", "DRAFT"),
  ];
  try {
    await transact(items);
  } catch (e) {
    if (txConditionFailed(e)) throw conflict("CONCURRENT_UPDATE", "A decision or another change happened at the same time. Reload and try again.");
    throw e;
  }
  return json(200, { requestId: r.id, status: "DRAFT", approvalState: "WITHDRAWN", round, closedRecords: pending.length, version: next.version });
};

/* ------------------------------------------------------------------ GET /approvals (my inbox) */
const INBOX_DECISIONS: Decision[] = ["PENDING", "APPROVED", "REJECTED", "NOT_REQUIRED"];

const inbox = async ({ caller, query }: Ctx) => {
  const decision = (query.decision ?? "PENDING").toUpperCase() as Decision;
  if (!INBOX_DECISIONS.includes(decision)) throw badRequest(`decision must be one of ${DECISIONS.join(", ")}`, [{ field: "decision", issue: "enum" }]);
  const limit = parseLimit(query.limit);
  const q = query.q?.trim().toLowerCase();
  const startKey = decodeToken(query.nextToken);
  assertTokenPartition(startKey, "GSI3PK", `APPROVER#${caller.userId}`);
  if (startKey && !String(startKey.GSI3SK ?? "").startsWith(`${decision}#`)) throw badRequest("Invalid nextToken");

  const page = await queryPage(
    {
      IndexName: "GSI3",
      KeyConditionExpression: "GSI3PK = :p AND begins_with(GSI3SK, :d)",
      ExpressionAttributeValues: { ":p": `APPROVER#${caller.userId}`, ":d": `${decision}#` },
      ScanIndexForward: false, // newest submission first
      ExclusiveStartKey: startKey,
    },
    limit,
    (rec) => !q || `${rec.title} ${rec.requestNo}`.toLowerCase().includes(q),
  );

  // Current request + my membership, so the UI can enable/disable the buttons (the backend re-checks on decide).
  const got = await batchGet(page.items.flatMap((rec) => [reqKey(rec.requestId), memberKey(rec.requestId, caller.userId)]));
  const items = page.items.map((rec) => {
    const request = got.get(`REQ#${rec.requestId}|META`);
    const member = got.get(`REQ#${rec.requestId}|MEMBER#${caller.userId}`);
    const isCurrent = !!request && request.approvalRound === rec.round;
    const check =
      rec.decision === "PENDING" && request && isCurrent
        ? canDecide({ caller, request, member, record: rec })
        : { ok: false, reason: rec.decision === "PENDING" ? "NOT_CURRENT_ROUND" : "DECIDED" };
    return {
      approvalId: `${rec.requestId}:${rec.round}`,
      requestId: rec.requestId,
      requestNo: rec.requestNo,
      title: rec.title,
      description: rec.description,
      requestedBy: rec.requestedBy,
      category: rec.category ?? null,
      priority: rec.priority ?? null,
      round: rec.round,
      policy: rec.policy,
      decision: rec.decision,
      comment: rec.comment ?? null,
      submittedAt: rec.submittedAt,
      decidedAt: rec.decidedAt ?? null,
      requestStatus: request?.status ?? null,
      canDecide: check.ok,
      blockedReason: check.reason,
    };
  });
  return json(200, { items, nextToken: encodeToken(page.lastKey) });
};

/* ------------------------------------------------------------------ GET /approvals/summary */
const summary = async ({ caller }: Ctx) => {
  const count = (d: Decision) =>
    queryCount({
      IndexName: "GSI3",
      KeyConditionExpression: "GSI3PK = :p AND begins_with(GSI3SK, :d)",
      ExpressionAttributeValues: { ":p": `APPROVER#${caller.userId}`, ":d": `${d}#` },
    });
  const [pending, approved, rejected] = await Promise.all([count("PENDING"), count("APPROVED"), count("REJECTED")]);
  return json(200, { pending, approved, rejected });
};

/* ------------------------------------------------------------------ GET /requests/{id}/approvals (history) */
const history = async ({ caller, path }: Ctx) => {
  const r = await loadRequest(path.requestId);
  await assertView(r, caller);
  // "APPR" matches both APPRROUND#<n> (headers) and APPR#<n>#<approver> (decision records).
  const rows = await queryAll({
    KeyConditionExpression: "PK = :p AND begins_with(SK, :s)",
    ExpressionAttributeValues: { ":p": `REQ#${r.id}`, ":s": "APPR" },
  });
  const rounds = rows
    .filter((x) => x.entityType === "APPROVAL_ROUND")
    .sort((a, b) => b.round - a.round)
    .map((h) => ({
      round: h.round,
      policy: h.policy,
      status: h.status,
      submittedAt: h.submittedAt,
      submittedBy: { id: h.submittedBy, displayName: h.submittedByName, activityRole: h.submittedByRole },
      decidedAt: h.decidedAt ?? null,
      approvers: rows
        .filter((x) => x.entityType === "APPROVAL_RECORD" && x.round === h.round)
        .map((x) => ({
          userId: x.approverId,
          displayName: x.approverName,
          initials: x.approverInitials,
          activityRole: x.activityRole,
          decision: x.decision,
          comment: x.comment ?? null,
          decidedAt: x.decidedAt ?? null,
        })),
    }));
  return json(200, {
    approvalState: r.approvalState ?? "NONE",
    approvalPolicy: policyOf(r),
    currentRound: r.approvalRound ?? 0,
    rounds,
  });
};

export const handler = router({
  "POST /requests/{requestId}/submit": submit,
  "POST /requests/{requestId}/withdraw": withdraw,
  "POST /requests/{requestId}/approvals/decision": decide,
  "GET /requests/{requestId}/approvals": history,
  "GET /approvals": inbox,
  "GET /approvals/summary": summary,
});

