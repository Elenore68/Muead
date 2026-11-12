import type { APIGatewayProxyEvent } from "aws-lambda";
import { ApiError } from "./errors";

/**
 * Organization-level groups (Cognito). They NEVER grant authority inside a maintenance activity.
 *  - PlatformAdmin:    platform administration and read access to all requests. No approval bypass.
 *  - ApprovalEligible: may be ASSIGNED as an approver. Authority still comes only from the per-request assignment.
 * Activity roles (OWNER / PARTICIPANT / APPROVER) are stored per request: see lib/members.ts.
 */
export type OrgRole = "PlatformAdmin" | "ApprovalEligible";
export const ORG_ROLES: OrgRole[] = ["PlatformAdmin", "ApprovalEligible"];

export interface Caller {
  userId: string;
  email: string;
  displayName: string;
  /** Organization-level groups from the verified token (refreshed at most every token lifetime, 1 h). */
  roles: OrgRole[];
  isAdmin: boolean;
  approvalEligible: boolean;
}

/** Cognito puts groups into the claim as "a,b" or "[a, b]" depending on the authorizer path. */
const parseGroups = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== "string" || !raw) return [];
  return raw
    .replace(/^\[|\]$/g, "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
};

/**
 * Reads the verified Cognito claims put there by the API Gateway authorizer.
 * The frontend must send the ID token (it carries email, name and cognito:groups).
 * Unknown groups (including the removed MaintenanceOwner / TechnicalParticipant / Approver) are ignored.
 */
export const getCaller = (event: APIGatewayProxyEvent): Caller => {
  const claims = event.requestContext?.authorizer?.claims as Record<string, unknown> | undefined;
  const sub = claims?.sub;
  if (typeof sub !== "string" || !sub) throw new ApiError(401, "UNAUTHENTICATED", "Missing or invalid token");
  const roles = parseGroups(claims?.["cognito:groups"]).filter((g): g is OrgRole => (ORG_ROLES as string[]).includes(g));
  const email = typeof claims?.email === "string" ? claims.email.toLowerCase() : "";
  const name = typeof claims?.name === "string" && claims.name ? claims.name : email.split("@")[0] || "User";
  return {
    userId: sub,
    email,
    displayName: name,
    roles,
    isAdmin: roles.includes("PlatformAdmin"),
    approvalEligible: roles.includes("ApprovalEligible"),
  };
};

export const initialsOf = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).charAt(0).toUpperCase() + parts[0].slice(1, 2).toLowerCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};

/** Platform administration only. Never used for activity authority (approvals). */
export const requireAdmin = (caller: Caller): void => {
  if (!caller.isAdmin) throw new ApiError(403, "FORBIDDEN", "This action requires the PlatformAdmin role");
};
