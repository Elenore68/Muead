import { ulid } from "ulid";
import { queryAll, TABLE, type Item, type TransactItem } from "./db";
import { ApiError, badRequest, forbidden, notFound } from "./errors";
import type { Access } from "./members";
import type { Status } from "./requests";

/**
 * TASK 08: readiness checklist (SOW 4.6).
 *
 * Decisions for the points the SOW leaves open (also in PROJECT-HANDOVER.md 14.5):
 *  - The template is the six groups named in the SOW, one default item each. It is copied onto the request in the same
 *    transaction that moves it to READINESS, so later template changes never alter running requests.
 *  - The owner or an admin may add and delete custom items (max 30). Template items cannot be deleted; an item that does
 *    not apply is marked NOT_APPLICABLE with a reason.
 *  - Owner, admin and participants update items (SOW: "participants update items"). Approvers only read.
 *  - Items can change only while the request is in READINESS. The checklist is the gate to IN_PROGRESS: every item must be
 *    DONE or NOT_APPLICABLE.
 */
export const CHECKLIST_GROUPS = ["BACKUP", "ACCESS", "FIREWALL_CONNECTIVITY", "TEAM_AVAILABILITY", "APP_DEPENDENCIES", "DOCUMENTATION"] as const;
export type ChecklistGroup = (typeof CHECKLIST_GROUPS)[number];

export const TEMPLATE: Record<ChecklistGroup, string> = {
  BACKUP: "Backups are taken and the restore has been verified",
  ACCESS: "Everyone who needs access has it (accounts, roles, approvals)",
  FIREWALL_CONNECTIVITY: "Firewall rules and network connectivity are confirmed",
  TEAM_AVAILABILITY: "The team is available for the whole maintenance window",
  APP_DEPENDENCIES: "Dependent applications and services are identified and informed",
  DOCUMENTATION: "Runbook, rollback plan and contacts are documented",
};

export const ITEM_STATES = ["PENDING", "DONE", "NOT_APPLICABLE"] as const;
export type ItemState = (typeof ITEM_STATES)[number];

export const MAX_CUSTOM_ITEMS = 30;
export const MAX_ITEM_TITLE = 200;
export const MAX_ITEM_NOTE = 500;

/** The only request status in which checklist items can change. */
export const CHECKLIST_STATUS: Status = "READINESS";

export const itemKey = (requestId: string, itemId: string) => ({ PK: `REQ#${requestId}`, SK: `READY#${itemId}` });
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export const isItemId = (id: string) => ULID.test(id);

const base = (requestId: string, p: { group: ChecklistGroup; title: string; custom: boolean; order: number; now: string; by?: { userId: string; displayName: string } }): Item => {
  const id = ulid();
  return {
    ...itemKey(requestId, id),
    entityType: "READINESS_ITEM",
    id,
    requestId,
    group: p.group,
    title: p.title,
    custom: p.custom,
    // Template items keep the SOW order; custom items come after them, oldest first (ULIDs are not ordered within a millisecond).
    order: p.order,
    state: "PENDING",
    createdAt: p.now,
    createdBy: p.by?.userId,
    updatedAt: p.now,
    version: 1,
  };
};

export const buildTemplateItems = (requestId: string, now: string): Item[] =>
  CHECKLIST_GROUPS.map((g, i) => base(requestId, { group: g, title: TEMPLATE[g], custom: false, order: i, now }));

export const sortItems = (items: Item[]): Item[] =>
  [...items].sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id)));

export const buildCustomItem = (requestId: string, group: ChecklistGroup, title: string, by: { userId: string; displayName: string }, now: string): Item =>
  base(requestId, { group, title, custom: true, order: 100, now, by });

export const toItemApi = (i: Item) => ({
  id: i.id,
  group: i.group as ChecklistGroup,
  title: i.title,
  custom: !!i.custom,
  state: i.state as ItemState,
  note: i.note ?? null,
  updatedBy: i.updatedBy ? { id: i.updatedBy, displayName: i.updatedByName } : null,
  updatedAt: i.updatedAt,
  version: i.version,
});

export const progressOf = (items: Item[]) => {
  const resolved = items.filter((i) => i.state !== "PENDING").length;
  return { total: items.length, resolved, done: items.filter((i) => i.state === "DONE").length, percent: items.length ? Math.round((resolved / items.length) * 100) : 0 };
};

/** Items that still block the move to IN_PROGRESS. */
export const unresolved = (items: Item[]): Item[] => items.filter((i) => i.state === "PENDING");

/** Gate for READINESS -> IN_PROGRESS. A request with no checklist at all cannot start either. */
export const validateReadinessGate = (items: Item[]): void => {
  if (items.length === 0) throw new ApiError(409, "READINESS_INCOMPLETE", "The readiness checklist is empty. Reload the request and try again.");
  const open = unresolved(items);
  if (open.length) {
    throw new ApiError(
      409,
      "READINESS_INCOMPLETE",
      `${open.length} readiness item${open.length === 1 ? " is" : "s are"} still pending. Mark each one done or not applicable before starting the maintenance.`,
      open.map((i) => ({ field: i.id, issue: "pending" })),
    );
  }
};

/** Transaction items that fail if any checklist item went back to PENDING since it was read. */
export const resolvedChecks = (items: Item[]): TransactItem[] =>
  items.map((i) => ({
    ConditionCheck: {
      TableName: TABLE,
      Key: itemKey(i.requestId, i.id),
      ConditionExpression: "attribute_exists(PK) AND #st <> :pending",
      ExpressionAttributeNames: { "#st": "state" },
      ExpressionAttributeValues: { ":pending": "PENDING" },
    },
  }));

/* ------------------------------------------------------------------ input */
export const parseItemPatch = (b: Record<string, unknown>): { version: number; state: ItemState; note?: string } => {
  if (typeof b.version !== "number" || !Number.isInteger(b.version)) throw badRequest("version is required", [{ field: "version", issue: "required" }]);
  if (typeof b.state !== "string" || !(ITEM_STATES as readonly string[]).includes(b.state)) {
    throw badRequest(`state must be one of ${ITEM_STATES.join(", ")}`, [{ field: "state", issue: "enum" }]);
  }
  let note: string | undefined;
  if (b.note !== undefined && b.note !== null && b.note !== "") {
    if (typeof b.note !== "string") throw badRequest("note must be a string", [{ field: "note", issue: "type" }]);
    note = b.note.trim() || undefined;
    if (note && note.length > MAX_ITEM_NOTE) throw badRequest(`note is too long (max ${MAX_ITEM_NOTE})`, [{ field: "note", issue: "max_length" }]);
  }
  if (b.state === "NOT_APPLICABLE" && !note) throw badRequest("A reason is required when an item is not applicable", [{ field: "note", issue: "required" }]);
  return { version: b.version, state: b.state as ItemState, note };
};

export const parseCustomItem = (b: Record<string, unknown>): { group: ChecklistGroup; title: string } => {
  if (typeof b.group !== "string" || !(CHECKLIST_GROUPS as readonly string[]).includes(b.group)) {
    throw badRequest(`group must be one of ${CHECKLIST_GROUPS.join(", ")}`, [{ field: "group", issue: "enum" }]);
  }
  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!title) throw badRequest("title is required", [{ field: "title", issue: "required" }]);
  if (title.length > MAX_ITEM_TITLE) throw badRequest(`title is too long (max ${MAX_ITEM_TITLE})`, [{ field: "title", issue: "max_length" }]);
  return { group: b.group as ChecklistGroup, title };
};

/* ------------------------------------------------------------------ permissions */
const inReadiness = (status: Status) => {
  if (status !== CHECKLIST_STATUS) {
    throw new ApiError(409, "INVALID_STATE", `The checklist can only change while the request is in Readiness (now ${status})`);
  }
};

/** Owner, admin and participants update items; approvers and strangers cannot. */
export const validateItemUpdate = (p: { access: Access; requestStatus: Status; item: Item | undefined }): void => {
  if (!p.item) throw notFound("Checklist item not found");
  if (!p.access.canEdit && p.access.role !== "PARTICIPANT") throw forbidden("Only the owner, participants or a platform admin can update the checklist");
  inReadiness(p.requestStatus);
};

export const validateCustomAdd = (p: { access: Access; requestStatus: Status; existing: Item[] }): void => {
  if (!p.access.canEdit) throw forbidden("Only the owner of this request can add checklist items");
  inReadiness(p.requestStatus);
  if (p.existing.filter((i) => i.custom).length >= MAX_CUSTOM_ITEMS) throw new ApiError(409, "ITEM_LIMIT", `A checklist can have at most ${MAX_CUSTOM_ITEMS} custom items`);
};

export const validateCustomDelete = (p: { access: Access; requestStatus: Status; item: Item | undefined }): void => {
  if (!p.item) throw notFound("Checklist item not found");
  if (!p.access.canEdit) throw forbidden("Only the owner of this request can delete checklist items");
  if (!p.item.custom) throw new ApiError(409, "TEMPLATE_ITEM", "Template items cannot be deleted. Mark the item as not applicable instead.");
  inReadiness(p.requestStatus);
};

export const listItems = (requestId: string, consistent = false): Promise<Item[]> =>
  queryAll({
    KeyConditionExpression: "PK = :p AND begins_with(SK, :r)",
    ExpressionAttributeValues: { ":p": `REQ#${requestId}`, ":r": "READY#" },
    ConsistentRead: consistent,
  });

/** Puts for the template items (used inside the transaction that enters READINESS). */
export const templatePuts = (requestId: string, now: string): TransactItem[] =>
  buildTemplateItems(requestId, now).map((Item) => ({ Put: { TableName: TABLE, Item, ConditionExpression: "attribute_not_exists(PK)" } }));
