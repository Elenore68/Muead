import { config } from "../config";

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: { field?: string; issue: string }[] = [],
  ) {
    super(message);
  }
}

type TokenProvider = () => Promise<string>;
let tokenProvider: TokenProvider | null = null;
let onUnauthorized: (() => void) | null = null;

/** Wired by AuthProvider so the client never imports auth code directly. */
export const configureClient = (opts: { getToken: TokenProvider; onUnauthorized: () => void }) => {
  tokenProvider = opts.getToken;
  onUnauthorized = opts.onUnauthorized;
};

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  signal?: AbortSignal;
}

/** JSON call to the Mue'ad API using the Cognito ID token (the backend authorizer expects the ID token). */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  if (!tokenProvider) throw new ApiClientError(401, "UNAUTHENTICATED", "Not signed in");
  const url = new URL(`${config.apiBaseUrl}/${path.replace(/^\/+/, "")}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: {
        Authorization: `Bearer ${await tokenProvider()}`,
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiClientError(0, "NETWORK_ERROR", "Cannot reach the server. Check your connection and try again.");
  }

  if (res.status === 401) {
    onUnauthorized?.();
    throw new ApiClientError(401, "UNAUTHENTICATED", "Your session has expired. Please sign in again.");
  }
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let data: any = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    /* non-JSON error body (for example from the gateway) */
  }
  if (!res.ok) {
    const e = data?.error;
    throw new ApiClientError(res.status, e?.code ?? `HTTP_${res.status}`, e?.message ?? friendlyStatus(res.status), e?.details ?? []);
  }
  return data as T;
}

const friendlyStatus = (s: number): string =>
  s === 403 ? "You do not have permission to do this."
  : s === 429 ? "Too many requests. Please wait a moment and try again."
  : s >= 500 ? "The server had a problem. Please try again."
  : "The request could not be completed.";

/** Human-readable text for any thrown value, for use in UI error states. */
export const errorMessage = (e: unknown): string => (e instanceof ApiClientError || e instanceof Error ? e.message : "Something went wrong.");
