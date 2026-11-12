import { beforeEach, describe, expect, test, vi } from "vitest";

// Contract test: every 04b call uses the method, path and body documented in docs/backend/api-specification.md.
vi.mock("../config", () => ({ config: { apiEnabled: true, apiBaseUrl: "https://api.test/v1", userPoolId: "p", clientId: "c" } }));

import { ApiClientError, configureClient } from "../api/client";
import { addMember, listMembers, removeMember, searchUsers } from "../api/members";
import { decide, getApprovalHistory, getApprovalSummary, listApprovals, setApprovalPolicy, submitRequest, withdrawRequest } from "../api/approvals";

type Call = { url: string; method: string; body: unknown; auth: string | null };
let calls: Call[] = [];
let nextResponse: { status: number; body?: unknown } = { status: 200, body: {} };

beforeEach(() => {
  calls = [];
  nextResponse = { status: 200, body: {} };
  configureClient({ getToken: async () => "id-token", onUnauthorized: () => {} });
  vi.stubGlobal("fetch", vi.fn(async (url: URL | string, init: RequestInit) => {
    calls.push({
      url: String(url),
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      auth: new Headers(init.headers).get("Authorization"),
    });
    return new Response(nextResponse.status === 204 ? null : JSON.stringify(nextResponse.body), { status: nextResponse.status });
  }));
});

const last = () => calls[calls.length - 1];
const B = "https://api.test/v1";

describe("members and directory", () => {
  test("GET /requests/{id}/members", async () => {
    await listMembers("R1");
    expect(last()).toMatchObject({ method: "GET", url: `${B}/requests/R1/members`, auth: "Bearer id-token" });
  });
  test("POST /requests/{id}/members", async () => {
    await addMember("R1", { userId: "U1", activityRole: "PARTICIPANT", specialty: "Database", responsibilities: "Backups" });
    expect(last()).toMatchObject({ method: "POST", url: `${B}/requests/R1/members`, body: { userId: "U1", activityRole: "PARTICIPANT", specialty: "Database", responsibilities: "Backups" } });
  });
  test("DELETE /requests/{id}/members/{userId} (204)", async () => {
    nextResponse = { status: 204 };
    await expect(removeMember("R1", "U1")).resolves.toBeUndefined();
    expect(last()).toMatchObject({ method: "DELETE", url: `${B}/requests/R1/members/U1` });
  });
  test("GET /users?q=&approverEligible=", async () => {
    await searchUsers({ q: "sa", approverEligible: true, limit: 20 });
    expect(last().url).toBe(`${B}/users?q=sa&approverEligible=true&limit=20`);
    await searchUsers({ q: "sa" });
    expect(last().url).toBe(`${B}/users?q=sa`);
  });
  test("ids are URL-encoded", async () => {
    await removeMember("R/1", "a b");
    expect(last().url).toBe(`${B}/requests/R%2F1/members/a%20b`);
  });
});

describe("approvals", () => {
  test("GET /approvals with decision and pagination", async () => {
    await listApprovals({ decision: "PENDING", limit: 10, q: "db", nextToken: "tok" });
    expect(last().url).toBe(`${B}/approvals?decision=PENDING&limit=10&q=db&nextToken=tok`);
  });
  test("GET /approvals/summary and history", async () => {
    await getApprovalSummary();
    expect(last().url).toBe(`${B}/approvals/summary`);
    await getApprovalHistory("R1");
    expect(last().url).toBe(`${B}/requests/R1/approvals`);
  });
  test("POST decision: no version; comment only when given", async () => {
    await decide("R1", "APPROVED");
    expect(last()).toMatchObject({ method: "POST", url: `${B}/requests/R1/approvals/decision`, body: { decision: "APPROVED" } });
    await decide("R1", "REJECTED", "Missing rollback plan");
    expect(last().body).toEqual({ decision: "REJECTED", comment: "Missing rollback plan" });
  });
  test("submit, withdraw and policy send the request version", async () => {
    await submitRequest("R1", 3);
    expect(last()).toMatchObject({ method: "POST", url: `${B}/requests/R1/submit`, body: { version: 3 } });
    await withdrawRequest("R1", "Approver left", 4);
    expect(last()).toMatchObject({ method: "POST", url: `${B}/requests/R1/withdraw`, body: { reason: "Approver left", version: 4 } });
    await setApprovalPolicy("R1", "ALL", 5);
    expect(last()).toMatchObject({ method: "PATCH", url: `${B}/requests/R1`, body: { approvalPolicy: "ALL", version: 5 } });
  });
  test("409 conflicts surface the backend code and message", async () => {
    nextResponse = { status: 409, body: { error: { code: "ALREADY_DECIDED", message: "You have already decided on this round" } } };
    const err = await decide("R1", "APPROVED").catch((e) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).toMatchObject({ status: 409, code: "ALREADY_DECIDED", message: "You have already decided on this round" });
  });
});
