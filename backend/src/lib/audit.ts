import { ulid } from "ulid";
import type { Item } from "./db";

/**
 * Audit entries are append-only items under the request partition: PK=REQ#<id>, SK=AUDIT#<timestamp>#<ulid>.
 * Every entry records the actor, the actor's activity role at that moment and snapshot names,
 * so the history stays readable after renames, role changes or removals.
 */
export interface AuditActor {
  userId: string;
  displayName: string;
  /** OWNER / PARTICIPANT / APPROVER in this request, or PLATFORM_ADMIN when acting as an administrator. */
  activityRole: string;
}

export const auditItem = (requestId: string, actor: AuditActor, action: string, extra: Item = {}): Item => {
  const at = new Date().toISOString();
  return {
    PK: `REQ#${requestId}`,
    SK: `AUDIT#${at}#${ulid()}`,
    entityType: "AUDIT",
    action,
    actorId: actor.userId,
    actorName: actor.displayName,
    actorActivityRole: actor.activityRole,
    at,
    ...extra,
  };
};
