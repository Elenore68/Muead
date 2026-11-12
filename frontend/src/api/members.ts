import { api } from "./client";

/*
 * Activity membership and user directory (docs/backend/api-specification.md 3.1, 3.6, 12.1).
 * Roles are per request: the same person can be OWNER in one request and APPROVER in another.
 */
export type ActivityRole = "OWNER" | "PARTICIPANT" | "APPROVER";
export type AssignableRole = Exclude<ActivityRole, "OWNER">;

export interface Member {
  userId: string;
  displayName: string;
  initials: string;
  activityRole: ActivityRole;
  status: "ACTIVE" | "REMOVED";
  specialty: string | null;
  responsibilities: string | null;
  assignedBy: { id: string; displayName: string; activityRole: string };
  assignedAt: string;
  removedBy: { id: string; displayName: string; activityRole: string } | null;
  removedAt: string | null;
}

export interface MembersResponse {
  items: Member[];
  limits: { maxApprovers: number; maxMembers: number };
}

/** Directory entry. The API deliberately returns no email address. */
export interface DirectoryUser {
  id: string;
  displayName: string;
  initials: string;
  approvalEligible: boolean;
}

export interface AddMemberInput {
  userId: string;
  activityRole: AssignableRole;
  specialty?: string;
  responsibilities?: string;
}

/** Participant specialties accepted by the backend (SOW teams). Also returned by GET /reference-data `teams`. */
export const SPECIALTIES = ["Cloud", "Database", "Application", "OS", "SecurityNetwork"] as const;
export const MIN_SEARCH = 2;

const enc = encodeURIComponent;

export const listMembers = (requestId: string, signal?: AbortSignal) =>
  api<MembersResponse>(`requests/${enc(requestId)}/members`, { signal });

export const addMember = (requestId: string, input: AddMemberInput) =>
  api<Member>(`requests/${enc(requestId)}/members`, { method: "POST", body: input });

export const removeMember = (requestId: string, userId: string) =>
  api<void>(`requests/${enc(requestId)}/members/${enc(userId)}`, { method: "DELETE" });

/** GET /users: `q` must be at least 2 characters (the backend returns 400 otherwise). */
export const searchUsers = (p: { q: string; approverEligible?: boolean; limit?: number }, signal?: AbortSignal) =>
  api<{ items: DirectoryUser[]; nextToken: string | null }>("users", {
    query: { q: p.q, approverEligible: p.approverEligible ? "true" : undefined, limit: p.limit },
    signal,
  });
