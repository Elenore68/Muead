import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../config", () => ({ config: { apiEnabled: true, apiBaseUrl: "https://api.test/v1", userPoolId: "p", clientId: "c" } }));
vi.mock("../api/validation", async (orig) => ({ ...(await orig<typeof import("../api/validation")>()), generateSummary: vi.fn(), saveSummary: vi.fn() }));
import * as api from "../api/validation";
import { ApiClientError, configureClient } from "../api/client";
import type { FinalReport } from "../api/validation";
import ReportTab from "../components/ReportTab";
import type { Viewer } from "../data/permissions";

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const owner: Viewer = { activityRole: "OWNER", canEdit: true, canManageMembers: true };
const participant: Viewer = { activityRole: "PARTICIPANT", canEdit: false, canManageMembers: false };
const report = (o: Partial<FinalReport> = {}): FinalReport => ({
  requestId: "R1", generatedAt: "2026-12-02T00:00:00Z", completedByName: "Owner", summary: "Patched",
  request: { requestNo: "REQ-0001", title: "Patch DB", description: "d", category: null, priority: null, environment: null, cloudPlatform: null, maintenanceType: null, scope: null, affectedSystems: [], schedule: null },
  people: { owner: { id: "u1", displayName: "Owner" }, participants: [], approvers: [] }, approval: { policy: "ANY_ONE", rounds: 1, decidedAt: null }, timeline: {},
  tasks: { total: 0, done: 0, percent: 0, items: [] }, readiness: { total: 0, resolved: 0, percent: 0, items: [] }, validation: { total: 0, passed: 0, failed: 0, items: [] },
  activity: { notes: 0, openIssues: 0, issues: [] }, ...o,
});
const props = (o: Partial<Parameters<typeof ReportTab>[0]> = {}) => ({
  requestId: "R1", status: "COMPLETED" as const, report: { kind: "ready" as const, data: report() }, retry: vi.fn(), viewer: owner, onChanged: vi.fn(), notify: vi.fn(), ...o,
});

describe("activity summary", () => {
  test("an AI draft is shown for review, can be edited, and only then saved with aiAssisted", async () => {
    vi.mocked(api.generateSummary).mockResolvedValue({ draft: "AI wrote this.", language: "ar", model: "m", saved: false });
    vi.mocked(api.saveSummary).mockResolvedValue({ text: "Edited by me.", language: "ar", aiAssisted: true, reviewedBy: "u1", reviewedByName: "Owner", reviewedAt: "2026-12-02T01:00:00Z" });
    const p = props();
    render(<ReportTab {...p} />);
    fireEvent.change(screen.getByLabelText("Summary language"), { target: { value: "ar" } });
    fireEvent.click(screen.getByRole("button", { name: /generate summary/i }));
    const box = (await screen.findByLabelText(/AI draft: review and edit/)) as HTMLTextAreaElement;
    expect(box.value).toBe("AI wrote this.");
    expect(api.saveSummary).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: " Edited by me. " } });
    fireEvent.click(screen.getByRole("button", { name: /save summary/i }));
    await waitFor(() => expect(api.saveSummary).toHaveBeenCalledWith("R1", { text: "Edited by me.", aiAssisted: true, language: "ar" }));
    await waitFor(() => expect(p.onChanged).toHaveBeenCalled());
    expect(api.generateSummary).toHaveBeenCalledWith("R1", "ar");
  });

  test("when AI is not enabled the message is shown and a person can still write the summary", async () => {
    vi.mocked(api.generateSummary).mockRejectedValue(new ApiClientError(503, "AI_DISABLED", "AI summaries are not enabled for this environment yet."));
    vi.mocked(api.saveSummary).mockResolvedValue({ text: "By hand", language: "en", aiAssisted: false, reviewedBy: "u1", reviewedByName: "Owner", reviewedAt: "2026-12-02T01:00:00Z" });
    render(<ReportTab {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: /generate summary/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/not enabled/);
    fireEvent.click(screen.getByRole("button", { name: /write summary/i }));
    fireEvent.change(screen.getByLabelText("Summary"), { target: { value: "By hand" } });
    fireEvent.click(screen.getByRole("button", { name: /save summary/i }));
    await waitFor(() => expect(api.saveSummary).toHaveBeenCalledWith("R1", { text: "By hand", aiAssisted: false, language: "en" }));
  });

  test("an empty summary is not saved; discard drops the draft", async () => {
    render(<ReportTab {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: /write summary/i }));
    fireEvent.click(screen.getByRole("button", { name: /save summary/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/empty/);
    expect(api.saveSummary).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /discard/i }));
    expect(screen.getByText(/No summary has been saved yet/)).toBeTruthy();
  });

  test("shows the saved summary with the reviewer and AI note; participants cannot change it", () => {
    const saved = { text: "Reviewed text.", language: "en" as const, aiAssisted: true, reviewedBy: "u1", reviewedByName: "Owner", reviewedAt: "2026-12-02T01:00:00Z" };
    render(<ReportTab {...props({ viewer: participant, report: { kind: "ready", data: report({ aiSummary: saved }) } })} />);
    expect(screen.getByText("Reviewed text.")).toBeTruthy();
    expect(screen.getByText(/Reviewed by Owner/).textContent).toMatch(/written with AI assistance/);
    expect(screen.queryByRole("button", { name: /generate summary/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /edit summary/i })).toBeNull();
  });
});

describe("API contract", () => {
  test("generate and save use the documented method, path and body", async () => {
    vi.unstubAllGlobals();
    const calls: { url: string; method: string; body: unknown }[] = [];
    configureClient({ getToken: async () => "t", onUnauthorized: () => {} });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
      return new Response("{}", { status: 200 });
    }));
    const real = await vi.importActual<typeof import("../api/validation")>("../api/validation");
    await real.generateSummary("R1", "en");
    await real.saveSummary("R1", { text: "x", aiAssisted: false, language: "ar" });
    const B = "https://api.test/v1/requests/R1/report/summary";
    expect(calls).toEqual([
      { url: `${B}/generate`, method: "POST", body: { language: "en" } },
      { url: B, method: "PUT", body: { text: "x", aiAssisted: false, language: "ar" } },
    ]);
    vi.unstubAllGlobals();
  });
});
