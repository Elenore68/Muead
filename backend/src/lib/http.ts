import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { getCaller, type Caller } from "./auth";
import { ApiError, badRequest } from "./errors";

const baseHeaders = (): Record<string, string> => ({
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN ?? "",
  "Access-Control-Allow-Headers": "Authorization,Content-Type,Idempotency-Key",
  "X-Content-Type-Options": "nosniff",
});

export const json = (status: number, body?: unknown, extra: Record<string, string> = {}): APIGatewayProxyResult => ({
  statusCode: status,
  headers: { ...baseHeaders(), ...extra },
  body: body === undefined ? "" : JSON.stringify(body),
});

export interface Ctx {
  event: APIGatewayProxyEvent;
  caller: Caller;
  /** Parsed JSON body ({} when empty). */
  body: Record<string, unknown>;
  path: Record<string, string>;
  query: Record<string, string>;
}
export type RouteHandler = (ctx: Ctx) => Promise<APIGatewayProxyResult>;

/**
 * Tiny router: handlers are keyed "METHOD /resource/{param}" (API Gateway resource path, relative to the stage).
 * Keep the keys in sync with the routes wired in infra/lib/muead-stack.ts.
 */
export const router =
  (routes: Record<string, RouteHandler>) =>
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
      const key = `${event.httpMethod} ${event.resource}`;
      const h = routes[key];
      if (!h) throw new ApiError(404, "NOT_FOUND", "Route not found");
      let body: Record<string, unknown> = {};
      if (event.body) {
        try {
          const parsed: unknown = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString() : event.body);
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
          body = parsed as Record<string, unknown>;
        } catch {
          throw badRequest("Request body must be a JSON object");
        }
      }
      const query: Record<string, string> = {};
      for (const [k, v] of Object.entries(event.queryStringParameters ?? {})) if (v !== undefined) query[k] = v;
      const path: Record<string, string> = {};
      for (const [k, v] of Object.entries(event.pathParameters ?? {})) if (v !== undefined) path[k] = decodeURIComponent(v);
      const res = await h({ event, caller: getCaller(event), body, path, query });
      return res;
    } catch (err) {
      if (err instanceof ApiError) {
        return json(err.status, {
          error: { code: err.code, message: err.message, details: err.details, requestId: event.requestContext?.requestId },
        });
      }
      // Never leak internals; log the full error for CloudWatch.
      console.error(JSON.stringify({ level: "error", requestId: event.requestContext?.requestId, message: String(err), stack: (err as Error)?.stack }));
      return json(500, { error: { code: "INTERNAL_ERROR", message: "Unexpected error", requestId: event.requestContext?.requestId } });
    }
  };

/* ---------- Pagination helpers ---------- */
export const encodeToken = (key: Record<string, unknown> | undefined): string | null =>
  key ? Buffer.from(JSON.stringify(key)).toString("base64url") : null;

export const decodeToken = (token: string | undefined): Record<string, unknown> | undefined => {
  if (!token) return undefined;
  try {
    const v: unknown = JSON.parse(Buffer.from(token, "base64url").toString());
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw badRequest("Invalid nextToken");
};

/**
 * A continuation key must belong to the partition being queried. Otherwise DynamoDB answers with a
 * ValidationException (a 500). Rejecting it here gives a clean 400 and never queries another partition.
 */
export const assertTokenPartition = (key: Record<string, unknown> | undefined, attribute: string, expected: string): void => {
  if (key && key[attribute] !== expected) throw badRequest("Invalid nextToken");
};

export const parseLimit = (raw: string | undefined, def = 25, max = 100): number => {
  if (raw === undefined) return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw badRequest("limit must be a positive integer");
  return Math.min(n, max);
};
