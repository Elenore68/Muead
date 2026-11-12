import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE, type Item } from "./db";
import { badRequest, notFound } from "./errors";

export const STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "SCHEDULED",
  "READINESS",
  "IN_PROGRESS",
  "VALIDATION",
  "COMPLETED",
  "CANCELLED",
] as const;
export type Status = (typeof STATUSES)[number];
export const PRIORITIES = ["HIGH", "MEDIUM", "LOW"] as const;

/** States in which the owner may still edit the plan (architecture doc, lifecycle section). */
export const EDITABLE_STATUSES: Status[] = ["DRAFT", "REJECTED"];
/** Dashboard "In Progress" groups the execution phases (api-specification.md section 1.9). */
export const IN_PROGRESS_STATUSES: Status[] = ["IN_PROGRESS", "READINESS", "VALIDATION"];

/* ---------- Keys ---------- */
export const reqKey = (id: string) => ({ PK: `REQ#${id}`, SK: "META" });
export const monthOf = (iso: string) => iso.slice(0, 7);
export const dayOf = (iso: string) => iso.slice(0, 10);

/** Index attributes derived from the request item (database-design.md section 3.2). Recomputed on every write. */
export const indexAttrs = (r: Item): Item => {
  const sortDate: string = r.scheduleStart ?? r.createdAt;
  const attrs: Item = {
    GSI1PK: `OWNER#${r.ownerId}`,
    GSI1SK: `${r.createdAt}#${r.id}`,
    GSI2PK: `STATUS#${r.status}`,
    GSI2SK: `${sortDate}#${r.id}`,
  };
  // LIMITATION (documented): an activity spanning several months is indexed under its start month only.
  if (r.scheduleStart && r.status !== "DRAFT") {
    attrs.GSI3PK = `SCHED#${monthOf(r.scheduleStart)}`;
    attrs.GSI3SK = `${r.scheduleStart}#${r.id}`;
  }
  return attrs;
};

/** Storage-only attributes never returned by the API. `membersRev` is an internal concurrency counter. */
const INTERNAL_KEYS = ["PK", "SK", "GSI1PK", "GSI1SK", "GSI2PK", "GSI2SK", "GSI3PK", "GSI3SK", "entityType", "membersRev"];

export const APPROVAL_POLICIES = ["ANY_ONE", "ALL"] as const;

/** Public representation (no storage keys). */
export const toApi = (r: Item): Item => {
  const out: Item = {};
  for (const [k, v] of Object.entries(r)) if (!INTERNAL_KEYS.includes(k)) out[k] = v;
  const { ownerId, ownerName, ownerInitials, scheduleStart, scheduleEnd, timezone, ...rest } = out;
  return {
    ...rest,
    approvalPolicy: r.approvalPolicy ?? "ANY_ONE",
    approvalRound: r.approvalRound ?? 0,
    owner: { id: ownerId, displayName: ownerName, initials: ownerInitials },
    schedule: scheduleStart ? { start: scheduleStart, end: scheduleEnd ?? null, timezone: timezone ?? null } : null,
  };
};

export const toSummary = (r: Item): Item => {
  const a = toApi(r);
  return {
    id: a.id,
    requestNo: a.requestNo,
    title: a.title,
    status: a.status,
    owner: a.owner,
    category: a.category ?? null,
    priority: a.priority ?? null,
    schedule: a.schedule,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    version: a.version,
  };
};

/* ---------- Validation ---------- */
const str = (v: unknown, field: string, max: number, required = false): string | undefined => {
  if (v === undefined || v === null || v === "") {
    if (required) throw badRequest(`${field} is required`, [{ field, issue: "required" }]);
    return undefined;
  }
  if (typeof v !== "string") throw badRequest(`${field} must be a string`, [{ field, issue: "type" }]);
  const t = v.trim();
  if (!t && required) throw badRequest(`${field} is required`, [{ field, issue: "required" }]);
  if (t.length > max) throw badRequest(`${field} is too long (max ${max})`, [{ field, issue: "max_length" }]);
  return t;
};

const isoDate = (v: unknown, field: string): string => {
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) throw badRequest(`${field} must be an ISO-8601 date-time`, [{ field, issue: "format" }]);
  return new Date(v).toISOString();
};

export interface RequestFields {
  title?: string;
  description?: string;
  environment?: string;
  cloudPlatform?: string;
  maintenanceType?: string;
  scope?: string;
  category?: string;
  priority?: string;
  affectedSystems?: string[];
  links?: { label: string; url: string }[];
  scheduleStart?: string;
  scheduleEnd?: string;
  timezone?: string;
  approvalPolicy?: string;
}

/**
 * Validates and normalizes request fields.
 * create: title + description required (the fields the current form marks required).
 * Everything else is optional while DRAFT; which SOW fields are mandatory at submit is an open question (doc OPEN 8).
 */
export const parseFields = (body: Record<string, unknown>, mode: "create" | "patch"): RequestFields => {
  const f: RequestFields = {};
  const req = mode === "create";
  const set = <K extends keyof RequestFields>(k: K, v: RequestFields[K]) => {
    if (v !== undefined) f[k] = v;
  };
  if (req || "title" in body) set("title", str(body.title, "title", 200, true));
  if (req || "description" in body) set("description", str(body.description, "description", 5000, true));
  if ("environment" in body) set("environment", str(body.environment, "environment", 60));
  if ("cloudPlatform" in body) set("cloudPlatform", str(body.cloudPlatform, "cloudPlatform", 60));
  if ("maintenanceType" in body) set("maintenanceType", str(body.maintenanceType, "maintenanceType", 60));
  if ("scope" in body) set("scope", str(body.scope, "scope", 5000));
  if ("category" in body) set("category", str(body.category, "category", 60));
  if ("priority" in body) {
    const p = str(body.priority, "priority", 10);
    if (p !== undefined && !(PRIORITIES as readonly string[]).includes(p)) throw badRequest("priority must be HIGH, MEDIUM or LOW", [{ field: "priority", issue: "enum" }]);
    set("priority", p);
  }
  if ("approvalPolicy" in body && body.approvalPolicy !== undefined) {
    const p = body.approvalPolicy;
    if (typeof p !== "string" || !(APPROVAL_POLICIES as readonly string[]).includes(p)) {
      throw badRequest("approvalPolicy must be ANY_ONE or ALL", [{ field: "approvalPolicy", issue: "enum" }]);
    }
    set("approvalPolicy", p);
  }
  if ("affectedSystems" in body && body.affectedSystems !== undefined) {
    const a = body.affectedSystems;
    if (!Array.isArray(a) || a.length > 50) throw badRequest("affectedSystems must be an array of up to 50 strings", [{ field: "affectedSystems", issue: "type" }]);
    set("affectedSystems", a.map((s) => str(s, "affectedSystems[]", 120, true) as string));
  }
  if ("links" in body && body.links !== undefined) {
    const l = body.links;
    if (!Array.isArray(l) || l.length > 20) throw badRequest("links must be an array of up to 20 items", [{ field: "links", issue: "type" }]);
    set(
      "links",
      l.map((x, i) => {
        const o = (x ?? {}) as Record<string, unknown>;
        const url = str(o.url, `links[${i}].url`, 2000, true) as string;
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          throw badRequest(`links[${i}].url is not a valid URL`, [{ field: `links[${i}].url`, issue: "format" }]);
        }
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw badRequest(`links[${i}].url must be http(s)`, [{ field: `links[${i}].url`, issue: "scheme" }]);
        return { label: str(o.label, `links[${i}].label`, 120) ?? url, url };
      }),
    );
  }
  if ("schedule" in body && body.schedule !== undefined) {
    const s = body.schedule as Record<string, unknown> | null;
    if (s === null || typeof s !== "object") throw badRequest("schedule must be an object", [{ field: "schedule", issue: "type" }]);
    const start = isoDate(s.start, "schedule.start");
    const end = s.end !== undefined ? isoDate(s.end, "schedule.end") : undefined;
    if (end && Date.parse(end) <= Date.parse(start)) throw badRequest("schedule.end must be after schedule.start", [{ field: "schedule.end", issue: "order" }]);
    set("scheduleStart", start);
    set("scheduleEnd", end);
    set("timezone", str(s.timezone, "schedule.timezone", 60));
  }
  return f;
};

/* ---------- Access ---------- */
/**
 * `consistent: true` = strongly consistent read. Required wherever the result feeds a state transition whose
 * condition does not cover every item read (submit, decide, withdraw); see the TASK 04a review, finding C2.
 */
export const loadRequest = async (id: string, opts: { consistent?: boolean } = {}): Promise<Item> => {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) throw notFound("Request not found");
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: reqKey(id), ConsistentRead: opts.consistent === true }));
  if (!res.Item || res.Item.archived) throw notFound("Request not found");
  return res.Item;
};

/** Attachments are part of the reviewed plan: frozen while approval is running and once the request is finished. */
export const ATTACHMENTS_LOCKED: Status[] = ["PENDING_APPROVAL", "COMPLETED", "CANCELLED"];

/** Transaction item that fails unless the request exists and its status allows attachment changes. */
export const attachmentsUnlockedCheck = (requestId: string) => {
  const values: Record<string, string> = {};
  ATTACHMENTS_LOCKED.forEach((s, i) => (values[`:l${i}`] = s));
  return {
    ConditionCheck: {
      TableName: TABLE,
      Key: reqKey(requestId),
      ConditionExpression: `attribute_exists(PK) AND NOT (#s IN (${ATTACHMENTS_LOCKED.map((_, i) => `:l${i}`).join(", ")}))`,
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: values,
    },
  };
};

// Visibility and edit rights are activity-scoped now: see assertView / assertEdit in lib/members.ts.
