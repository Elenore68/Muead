import { queryAll, TABLE, type Item, type TransactItem } from "./db";
import { ApiError, badRequest, forbidden, notFound } from "./errors";
import type { Access } from "./members";
import { reqKey, type Status } from "./requests";

/**
 * TASK 10: post-maintenance validation (SOW 4.9) and the closure rules (SOW 4.10 is a heading only, so these are
 * decisions; see PROJECT-HANDOVER.md 14.7).
 *  - Validation has one item per domain named in the SOW: application, database, operating system, infrastructure.
 *    The four items are created in the same transaction that moves the request to VALIDATION.
 *  - Each item ends as PASSED, FAILED or NOT_APPLICABLE. FAILED and NOT_APPLICABLE need a note.
 *  - Owner, admin and participants record results, only while the request is in VALIDATION. Approvers only read.
 *  - Closing (VALIDATION -> COMPLETED) needs every item resolved and a closing summary. If any item FAILED or any issue is
 *    still open, the "remaining issues" text is required too (SOW 4.9: "remaining issues").
 */
export const DOMAINS = ["APPLICATION", "DATABASE", "OS", "INFRASTRUCTURE"] as const;
export type Domain = (typeof DOMAINS)[number];
export const DOMAIN_TITLE: Record<Domain, string> = {
  APPLICATION: "Application works as expected",
  DATABASE: "Database is healthy and data is intact",
  OS: "Operating systems are stable",
  INFRASTRUCTURE: "Infrastructure and connectivity are normal",
};

export const RESULTS = ["PENDING", "PASSED", "FAILED", "NOT_APPLICABLE"] as const;
export type Result = (typeof RESULTS)[number];

export const MAX_NOTE = 1000;
export const MAX_SUMMARY = 5000;
export const MAX_REMAINING = 2000;

export const validationKey = (requestId: string, domain: string) => ({ PK: `REQ#${requestId}`, SK: `VALID#${domain}` });

export const buildValidationItems = (requestId: string, now: string): Item[] =>
  DOMAINS.map((domain, order) => ({
    ...validationKey(requestId, domain),
    entityType: "VALIDATION_ITEM",
    requestId,
    domain,
    title: DOMAIN_TITLE[domain],
    order,
    result: "PENDING",
    createdAt: now,
    updatedAt: now,
    version: 1,
  }));

export const validationPuts = (requestId: string, now: string): TransactItem[] =>
  buildValidationItems(requestId, now).map((Item) => ({ Put: { TableName: TABLE, Item, ConditionExpression: "attribute_not_exists(PK)" } }));

export const listValidation = async (requestId: string, consistent = false): Promise<Item[]> =>
  (await queryAll({
    KeyConditionExpression: "PK = :p AND begins_with(SK, :v)",
    ExpressionAttributeValues: { ":p": `REQ#${requestId}`, ":v": "VALID#" },
    ConsistentRead: consistent,
  })).sort((a, b) => (a.order ?? 9) - (b.order ?? 9));

export const toValidationApi = (i: Item) => ({
  domain: i.domain as Domain,
  title: i.title,
  result: i.result as Result,
  note: i.note ?? null,
  updatedBy: i.updatedBy ? { id: i.updatedBy, displayName: i.updatedByName } : null,
  updatedAt: i.updatedAt,
  version: i.version,
});

export const validationProgress = (items: Item[]) => {
  const resolved = items.filter((i) => i.result !== "PENDING").length;
  return {
    total: items.length,
    resolved,
    passed: items.filter((i) => i.result === "PASSED").length,
    failed: items.filter((i) => i.result === "FAILED").length,
    percent: items.length ? Math.round((resolved / items.length) * 100) : 0,
  };
};

/* ------------------------------------------------------------------ input */
export const parseResult = (b: Record<string, unknown>): { version: number; result: Result; note?: string } => {
  if (typeof b.version !== "number" || !Number.isInteger(b.version)) throw badRequest("version is required", [{ field: "version", issue: "required" }]);
  if (typeof b.result !== "string" || !(RESULTS as readonly string[]).includes(b.result)) {
    throw badRequest(`result must be one of ${RESULTS.join(", ")}`, [{ field: "result", issue: "enum" }]);
  }
  let note: string | undefined;
  if (b.note !== undefined && b.note !== null && b.note !== "") {
    if (typeof b.note !== "string") throw badRequest("note must be a string", [{ field: "note", issue: "type" }]);
    note = b.note.trim() || undefined;
    if (note && note.length > MAX_NOTE) throw badRequest(`note is too long (max ${MAX_NOTE})`, [{ field: "note", issue: "max_length" }]);
  }
  if ((b.result === "FAILED" || b.result === "NOT_APPLICABLE") && !note) {
    throw badRequest(b.result === "FAILED" ? "Describe what failed" : "A reason is required when a check is not applicable", [{ field: "note", issue: "required" }]);
  }
  return { version: b.version, result: b.result as Result, note };
};

export interface Closure {
  summary: string;
  remainingIssues?: string;
}

const text = (v: unknown, field: string, max: number, required: boolean): string | undefined => {
  if (v === undefined || v === null || v === "") {
    if (required) throw badRequest(`${field} is required`, [{ field, issue: "required" }]);
    return undefined;
  }
  if (typeof v !== "string") throw badRequest(`${field} must be a string`, [{ field, issue: "type" }]);
  const t = v.trim();
  if (!t && required) throw badRequest(`${field} is required`, [{ field, issue: "required" }]);
  if (t.length > max) throw badRequest(`${field} is too long (max ${max})`, [{ field, issue: "max_length" }]);
  return t || undefined;
};

export const parseClosure = (b: Record<string, unknown>): Closure => ({
  summary: text(b.summary, "summary", MAX_SUMMARY, true)!,
  remainingIssues: text(b.remainingIssues, "remainingIssues", MAX_REMAINING, false),
});

/* ------------------------------------------------------------------ rules */
/**
 * Gate for VALIDATION -> COMPLETED. `openIssues` = open entries of the activity log.
 * Remaining issues must be written down when something failed or is still open.
 */
export const validateClosure = (p: { items: Item[]; openIssues: number; closure: Closure }): { hasRemaining: boolean } => {
  if (p.items.length === 0) throw new ApiError(409, "VALIDATION_INCOMPLETE", "The validation checks are missing. Reload the request and try again.");
  const pending = p.items.filter((i) => i.result === "PENDING");
  if (pending.length) {
    throw new ApiError(
      409,
      "VALIDATION_INCOMPLETE",
      `${pending.length} validation check${pending.length === 1 ? " is" : "s are"} still pending. Record a result for every domain before closing.`,
      pending.map((i) => ({ field: i.domain, issue: "pending" })),
    );
  }
  const hasRemaining = p.items.some((i) => i.result === "FAILED") || p.openIssues > 0;
  if (hasRemaining && !p.closure.remainingIssues) {
    throw badRequest("List the remaining issues: a validation check failed or an issue is still open", [{ field: "remainingIssues", issue: "required" }]);
  }
  return { hasRemaining };
};

/** Transaction items that fail if a validation result went back to PENDING since it was read. */
export const resolvedValidationChecks = (items: Item[]): TransactItem[] =>
  items.map((i) => ({
    ConditionCheck: {
      TableName: TABLE,
      Key: validationKey(i.requestId, i.domain),
      ConditionExpression: "attribute_exists(PK) AND #r <> :pending",
      ExpressionAttributeNames: { "#r": "result" },
      ExpressionAttributeValues: { ":pending": "PENDING" },
    },
  }));

export const validateResultUpdate = (p: { access: Access; requestStatus: Status; item: Item | undefined }): void => {
  if (!p.item) throw notFound("Validation check not found");
  if (!p.access.canEdit && p.access.role !== "PARTICIPANT") throw forbidden("Only the owner, participants or a platform admin can record validation results");
  if (p.requestStatus !== "VALIDATION") {
    throw new ApiError(409, "INVALID_STATE", `Validation results can only change while the request is in Validation (now ${p.requestStatus})`);
  }
};

/** Transaction item: fails unless the request is still in VALIDATION. */
export const inValidationCheck = (requestId: string): TransactItem => ({
  ConditionCheck: {
    TableName: TABLE,
    Key: reqKey(requestId),
    ConditionExpression: "attribute_exists(PK) AND #s = :v",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":v": "VALIDATION" },
  },
});
