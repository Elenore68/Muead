import type { APIGatewayProxyEvent } from "aws-lambda";
import { ApiError } from "./errors";

export type Role = "MaintenanceOwner" | "TechnicalParticipant" | "Approver" | "PlatformAdmin";
const ALL_ROLES: Role[] = ["MaintenanceOwner", "TechnicalParticipant", "Approver", "PlatformAdmin"];

export interface Caller {
  userId: string;
  email: string;
  displayName: string;
  roles: Role[];
  isAdmin: boolean;
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
 */
export const getCaller = (event: APIGatewayProxyEvent): Caller => {
  const claims = event.requestContext?.authorizer?.claims as Record<string, unknown> | undefined;
  const sub = claims?.sub;
  if (typeof sub !== "string" || !sub) throw new ApiError(401, "UNAUTHENTICATED", "Missing or invalid token");
  const roles = parseGroups(claims?.["cognito:groups"]).filter((g): g is Role => (ALL_ROLES as string[]).includes(g));
  const email = typeof claims?.email === "string" ? claims.email.toLowerCase() : "";
  const name = typeof claims?.name === "string" && claims.name ? claims.name : email.split("@")[0] || "User";
  return { userId: sub, email, displayName: name, roles, isAdmin: roles.includes("PlatformAdmin") };
};

export const initialsOf = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).charAt(0).toUpperCase() + parts[0].slice(1, 2).toLowerCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};

export const requireRole = (caller: Caller, ...allowed: Role[]): void => {
  if (caller.isAdmin) return;
  if (!caller.roles.some((r) => allowed.includes(r))) throw new ApiError(403, "FORBIDDEN", "Your role cannot perform this action");
};
