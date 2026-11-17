import { ulid } from "ulid";
import { queryAll, type Item } from "./db";
import { ApiError, badRequest, forbidden, notFound } from "./errors";
import type { Access } from "./members";
import type { Status } from "./requests";

/**
 * TASK 09: maintenance execution tracking (SOW 4.7 is a heading only, so these are decisions; see PROJECT-HANDOVER.md 14.6).
 *  - The Activity tab is a log of progress NOTES and ISSUES for one request. Entries are never edited or deleted.
 *  - An issue has a severity and is OPEN until someone resolves it (with a note). It can be reopened.
 *  - Owner, admin and participants write entries and resolve issues; approvers read only.
 *  - Entries can be added while the request is IN_PROGRESS or VALIDATION (the execution stages). Everything stays readable.
 */
export const ENTRY_TYPES = ["NOTE", "ISSUE"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];
export const SEVERITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const ISSUE_STATES = ["OPEN", "RESOLVED"] as const;
export type IssueState = (typeof ISSUE_STATES)[number];

export const EXECUTION_STATUSES: Status[] = ["IN_PROGRESS", "VALIDATION"];
export const MAX_ENTRY_TEXT = 2000;
export const MAX_RESOLUTION_NOTE = 1000;
export const MAX_ENTRIES = 500;

export const entryKey = (requestId: string, entryId: string) => ({ PK: `REQ#${requestId}`, SK: `ACT#${entryId}` });
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export const isEntryId = (id: string) => ULID.test(id);

export const parseEntry = (b: Record<string, unknown>): { type: EntryType; text: string; severity?: Severity } => {
  if (typeof b.type !== "string" || !(ENTRY_TYPES as readonly string[]).includes(b.type)) {
    throw badRequest("type must be NOTE or ISSUE", [{ field: "type", issue: "enum" }]);
  }
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text) throw badRequest("text is required", [{ field: "text", issue: "required" }]);
  if (text.length > MAX_ENTRY_TEXT) throw badRequest(`text is too long (max ${MAX_ENTRY_TEXT})`, [{ field: "text", issue: "max_length" }]);
  if (b.type === "ISSUE") {
    if (typeof b.severity !== "string" || !(SEVERITIES as readonly string[]).includes(b.severity)) {
      throw badRequest("severity must be LOW, MEDIUM or HIGH", [{ field: "severity", issue: "enum" }]);
    }
    return { type: "ISSUE", text, severity: b.severity as Severity };
  }
  if (b.severity !== undefined && b.severity !== null) throw badRequest("Notes have no severity", [{ field: "severity", issue: "not_allowed" }]);
  return { type: "NOTE", text };
};

export const parseResolution = (b: Record<string, unknown>): { version: number; state: IssueState; note?: string } => {
  if (typeof b.version !== "number" || !Number.isInteger(b.version)) throw badRequest("version is required", [{ field: "version", issue: "required" }]);
  if (typeof b.state !== "string" || !(ISSUE_STATES as readonly string[]).includes(b.state)) {
    throw badRequest("state must be OPEN or RESOLVED", [{ field: "state", issue: "enum" }]);
  }
  let note: string | undefined;
  if (b.note !== undefined && b.note !== null && b.note !== "") {
    if (typeof b.note !== "string") throw badRequest("note must be a string", [{ field: "note", issue: "type" }]);
    note = b.note.trim() || undefined;
    if (note && note.length > MAX_RESOLUTION_NOTE) throw badRequest(`note is too long (max ${MAX_RESOLUTION_NOTE})`, [{ field: "note", issue: "max_length" }]);
  }
  if (b.state === "RESOLVED" && !note) throw badRequest("Describe how the issue was resolved", [{ field: "note", issue: "required" }]);
  return { version: b.version, state: b.state as IssueState, note };
};

export const buildEntry = (p: { requestId: string; input: ReturnType<typeof parseEntry>; actor: { userId: string; displayName: string }; role: string; now: string }): Item => {
  const id = ulid();
  return {
    ...entryKey(p.requestId, id),
    entityType: "ACTIVITY_ENTRY",
    id,
    requestId: p.requestId,
    type: p.input.type,
    text: p.input.text,
    severity: p.input.severity,
    state: p.input.type === "ISSUE" ? "OPEN" : undefined,
    authorId: p.actor.userId,
    authorName: p.actor.displayName,
    authorRole: p.role,
    createdAt: p.now,
    version: 1,
  };
};

export const toEntryApi = (e: Item) => ({
  id: e.id,
  type: e.type as EntryType,
  text: e.text,
  severity: (e.severity ?? null) as Severity | null,
  state: (e.state ?? null) as IssueState | null,
  resolutionNote: e.resolutionNote ?? null,
  resolvedBy: e.resolvedBy ? { id: e.resolvedBy, displayName: e.resolvedByName } : null,
  resolvedAt: e.resolvedAt ?? null,
  author: { id: e.authorId, displayName: e.authorName, activityRole: e.authorRole },
  createdAt: e.createdAt,
  version: e.version,
});

export const listEntries = (requestId: string, consistent = false): Promise<Item[]> =>
  queryAll(
    {
      KeyConditionExpression: "PK = :p AND begins_with(SK, :a)",
      ExpressionAttributeValues: { ":p": `REQ#${requestId}`, ":a": "ACT#" },
      ConsistentRead: consistent,
    },
    MAX_ENTRIES + 1,
  );

/** Newest first. */
export const sortEntries = (items: Item[]): Item[] => [...items].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.id).localeCompare(String(a.id)));

export const openIssues = (items: Item[]): Item[] => items.filter((e) => e.type === "ISSUE" && e.state === "OPEN");

export const summaryOf = (items: Item[]) => {
  const issues = items.filter((e) => e.type === "ISSUE");
  return { notes: items.length - issues.length, issues: issues.length, openIssues: openIssues(items).length, openHigh: openIssues(items).filter((e) => e.severity === "HIGH").length };
};

/* ------------------------------------------------------------------ permissions */
const canWrite = (a: Access) => a.canEdit || a.role === "PARTICIPANT";

const inExecution = (status: Status) => {
  if (!EXECUTION_STATUSES.includes(status)) {
    throw new ApiError(409, "INVALID_STATE", `Activity can be added while the maintenance is In Progress or in Validation (now ${status})`);
  }
};

export const validateAddEntry = (p: { access: Access; requestStatus: Status; existing: number }): void => {
  if (!canWrite(p.access)) throw forbidden("Only the owner, participants or a platform admin can add to the activity log");
  inExecution(p.requestStatus);
  if (p.existing >= MAX_ENTRIES) throw new ApiError(409, "ENTRY_LIMIT", `A request can have at most ${MAX_ENTRIES} activity entries`);
};

export const validateResolve = (p: { access: Access; requestStatus: Status; entry: Item | undefined }): void => {
  if (!p.entry) throw notFound("Entry not found");
  if (!canWrite(p.access)) throw forbidden("Only the owner, participants or a platform admin can resolve issues");
  if (p.entry.type !== "ISSUE") throw new ApiError(409, "NOT_AN_ISSUE", "Only issues can be resolved");
  inExecution(p.requestStatus);
};
