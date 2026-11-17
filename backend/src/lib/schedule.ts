import type { Item } from "./db";
import { monthOf } from "./requests";

/**
 * TASK 12: schedule and conflicts (SOW 4.4). The SOW does not say what a conflict is, so these are decisions
 * (PROJECT-HANDOVER.md 14.9). Conflicts are WARNINGS: nothing is blocked.
 *
 * Two maintenance activities conflict when their time windows overlap AND at least one of these holds:
 *  - SYSTEM: same environment and at least one affected system in common (names compared ignoring case and spaces).
 *  - PEOPLE: the same person is an active owner or participant of both (approvers do not do the work, so they do not count).
 * A window is schedule.start .. schedule.end; without an end it is the 24 hours after the start.
 * Only activities that are still planned or running are compared (not Draft, Rejected, Cancelled or Completed).
 */
export const CONFLICT_STATUSES = ["PENDING_APPROVAL", "APPROVED", "SCHEDULED", "READINESS", "IN_PROGRESS", "VALIDATION"] as const;
export const isActiveForConflicts = (r: Item): boolean => (CONFLICT_STATUSES as readonly string[]).includes(r.status) && !r.archived && !!r.scheduleStart;

const DAY_MS = 86_400_000;

export const windowOf = (r: Item): { start: number; end: number } | undefined => {
  if (!r.scheduleStart) return undefined;
  const start = Date.parse(r.scheduleStart);
  if (Number.isNaN(start)) return undefined;
  const end = r.scheduleEnd ? Date.parse(r.scheduleEnd) : NaN;
  return { start, end: Number.isNaN(end) || end <= start ? start + DAY_MS : end };
};

export const overlaps = (a: Item, b: Item): boolean => {
  const wa = windowOf(a);
  const wb = windowOf(b);
  return !!wa && !!wb && wa.start < wb.end && wb.start < wa.end;
};

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export const sharedSystems = (a: Item, b: Item): string[] => {
  if (!a.environment || norm(a.environment) !== norm(b.environment)) return [];
  const mine = new Map<string, string>((a.affectedSystems ?? []).map((s: string) => [norm(s), s]));
  return [...new Set<string>((b.affectedSystems ?? []).map(norm))].filter((n) => n && mine.has(n)).map((n) => mine.get(n)!);
};

/** Active owners and participants (the people who do the work). */
export const workers = (members: Item[]): Item[] => members.filter((m) => m.status === "ACTIVE" && (m.activityRole === "OWNER" || m.activityRole === "PARTICIPANT"));

export const sharedPeople = (a: Item[], b: Item[]): Item[] => {
  const ids = new Set(workers(b).map((m) => m.userId));
  return workers(a).filter((m) => ids.has(m.userId));
};

export interface Reason {
  type: "SYSTEM" | "PEOPLE";
  /** Shared system names, or the number of shared people. */
  systems?: string[];
  people?: { id: string; displayName: string }[];
}

/** Reasons why `other` conflicts with `subject` ([] = no conflict). `membersOf` is only called when needed. */
export const conflictReasons = async (subject: Item, other: Item, membersOf: (id: string) => Promise<Item[]>): Promise<Reason[]> => {
  if (subject.id === other.id || !isActiveForConflicts(other) || !overlaps(subject, other)) return [];
  const reasons: Reason[] = [];
  const systems = sharedSystems(subject, other);
  if (systems.length) reasons.push({ type: "SYSTEM", systems });
  const people = sharedPeople(await membersOf(subject.id), await membersOf(other.id));
  if (people.length) reasons.push({ type: "PEOPLE", people: people.map((m) => ({ id: m.userId, displayName: m.displayName })) });
  return reasons;
};

/** Month partitions (SCHED#yyyy-mm) that can hold activities overlapping [from, to]. Activities are indexed by start month only,
 *  so the previous month is included to catch ones that started shortly before; activities longer than about a month can be missed. */
export const monthsFor = (fromMs: number, toMs: number): string[] => {
  const months: string[] = [];
  const first = new Date(fromMs - 31 * DAY_MS);
  for (let d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1)); d.getTime() <= toMs; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    months.push(monthOf(d.toISOString()));
  }
  return months;
};

export const MAX_RANGE_DAYS = 62;
export const MAX_CANDIDATES = 200;
