import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("../config", () => ({ config: { apiEnabled: true, apiBaseUrl: "https://api.test/v1", userPoolId: "p", clientId: "c" } }));
vi.mock("../api/validation", async (orig) => ({ ...(await orig<typeof import("../api/validation")>()), setResult: vi.fn() }));
vi.mock("../api/requests", async (orig) => ({ ...(await orig<typeof import("../api/requests")>()), transitionRequest: vi.fn(), cancelRequest: vi.fn(), updateRequest: vi.fn() }));
import * as vApi from "../api/validation";
import * as rApi from "../api/requests";
import { configureClient } from "../api/client";
import type { FinalReport, ValidationItem, ValidationState } from "../api/validation";
import ValidationTab from "../components/ValidationTab";
import ReportTab from "../components/ReportTab";
import LifecycleCard from "../components/LifecycleCard";
import { EMPTY_VALUES } from "../components/RequestFields";
import { canRecordValidation, type Viewer } from "../data/permissions";

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const owner: Viewer = { activityRole: "OWNER", canEdit: true, canManageMembers: true, lifecycle: { next: "COMPLETED", canCancel: false } };
const participant: Viewer = { activityRole: "PARTICIPANT", canEdit: false, canManageMembers: false };
const approver: Viewer = { activityRole: "APPROVER", canEdit: false, canManageMembers: false };
const item = (o: Partial<ValidationItem> = {}): ValidationItem => ({
  domain: "APPLICATION", title: "Application works as expected", result: "PENDING", note: null, updatedBy: null, updatedAt: "2026-12-01T00:00:00Z", version: 1, ...o,
});
const ready = (items: ValidationItem[], started = true): { kind: "ready"; data: ValidationState } => {
  const resolved = items.filter((i) => i.result !== "PENDING").length;
  return { kind: "ready", data: { items, started, requestStatus: "VALIDATION", progress: { total: items.length, resolved, passed: 0, failed: items.filter((i) => i.result === "FAILED").length, percent: items.length ? Math.round((resolved / items.length) * 100) : 0 } } };
};
const props = (o: Partial<Parameters<typeof ValidationTab>[0]> = {}) => ({
  requestId: "R1", status: "VALIDATION" as const, viewer: owner, validation: ready([item(), item({ domain: "DATABASE", title: "Database is healthy" })]), retry: vi.fn(), onChanged: vi.fn(), notify: vi.fn(), ...o,
});

describe("permissions", () => {
  test("owner, admin and participants record results during Validation only", () => {
    expect(canRecordValidation(owner, "VALIDATION")).toBe(true);
    expect(canRecordValidation(participant, "VALIDATION")).toBe(true);
    expect(canRecordValidation(approver, "VALIDATION")).toBe(false);
    expect(canRecordValidation(owner, "IN_PROGRESS")).toBe(false);
    expect(canRecordValidation(owner, "COMPLETED")).toBe(false);
  });
});

describe("ValidationTab", () => {
  test("before the stage, it explains when the checks appear", () => {
    render(<ValidationTab {...props({ status: "IN_PROGRESS", validation: ready([], false) })} />);
    expect(screen.getByText(/created when the request moves to Validation/)).toBeTruthy();
  });

  test("a participant records a pass with the item's version", async () => {
    vi.mocked(vApi.setResult).mockResolvedValue(item({ result: "PASSED", version: 2 }));
    const p = props({ viewer: participant });
    render(<ValidationTab {...p} />);
    fireEvent.change(screen.getByLabelText("Result for Application"), { target: { value: "PASSED" } });
    await waitFor(() => expect(vApi.setResult).toHaveBeenCalledWith("R1", "APPLICATION", 1, "PASSED", undefined));
    await waitFor(() => expect(p.onChanged).toHaveBeenCalled());
  });

  test("failed needs a description", async () => {
    vi.mocked(vApi.setResult).mockResolvedValue(item({ result: "FAILED", note: "500 errors", version: 2 }));
    render(<ValidationTab {...props()} />);
    fireEvent.change(screen.getByLabelText("Result for Application"), { target: { value: "FAILED" } });
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog.querySelector("button[type=submit]")!);
    expect(vApi.setResult).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/What failed/), { target: { value: "500 errors" } });
    fireEvent.click(dialog.querySelector("button[type=submit]")!);
    await waitFor(() => expect(vApi.setResult).toHaveBeenCalledWith("R1", "APPLICATION", 1, "FAILED", "500 errors"));
  });

  test("approvers and other stages are read-only", () => {
    render(<ValidationTab {...props({ viewer: approver })} />);
    expect(screen.queryByLabelText("Result for Application")).toBeNull();
    cleanup();
    render(<ValidationTab {...props({ status: "COMPLETED" })} />);
    expect(screen.queryByLabelText("Result for Application")).toBeNull();
  });
});

describe("closing the request", () => {
  const card = () => {
    const p = { requestId: "R1", status: "VALIDATION" as const, version: 9, viewer: owner, fields: EMPTY_VALUES, onChanged: vi.fn(), notify: vi.fn() };
    render(<LifecycleCard {...p} />);
    return p;
  };

  test("the last step opens a closing dialog and sends the summary with the transition", async () => {
    vi.mocked(rApi.transitionRequest).mockResolvedValue({ requestId: "R1", status: "COMPLETED", previousStatus: "VALIDATION", version: 10 });
    const p = card();
    fireEvent.click(screen.getByRole("button", { name: /mark as completed/i }));
    expect(rApi.transitionRequest).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /complete request/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/closing summary/i);
    fireEvent.change(within(dialog).getByLabelText(/Closing summary/), { target: { value: " Patched without downtime " } });
    fireEvent.change(within(dialog).getByLabelText(/Remaining issues/), { target: { value: "One slow query" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /complete request/i }));
    await waitFor(() => expect(rApi.transitionRequest).toHaveBeenCalledWith("R1", "COMPLETED", 9, { summary: "Patched without downtime", remainingIssues: "One slow query" }));
    await waitFor(() => expect(p.onChanged).toHaveBeenCalled());
  });

  test("a refusal from the backend stays inside the dialog", async () => {
    vi.mocked(rApi.transitionRequest).mockRejectedValue(new Error("2 validation checks are still pending."));
    card();
    fireEvent.click(screen.getByRole("button", { name: /mark as completed/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Closing summary/), { target: { value: "Done" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /complete request/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/still pending/);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("ReportTab", () => {
  const report: FinalReport = {
    requestId: "R1", generatedAt: "2026-12-02T00:00:00Z", completedByName: "Owner", summary: "Patched without downtime", remainingIssues: "One slow query",
    request: { requestNo: "REQ-0001", title: "Patch DB", description: "d", category: null, priority: null, environment: "Production", cloudPlatform: "AWS", maintenanceType: "Patching", scope: null, affectedSystems: [], schedule: null },
    people: { owner: { id: "u1", displayName: "Owner" }, participants: [{ id: "u2", displayName: "Sara", specialty: null, participation: "CONFIRMED" }], approvers: [{ id: "u3", displayName: "Amal" }] },
    approval: { policy: "ALL", rounds: 1, decidedAt: null },
    timeline: { createdAt: "2026-11-10T00:00:00Z", submittedAt: null, completedAt: "2026-12-02T00:00:00Z" },
    tasks: { total: 2, done: 1, percent: 50, items: [{ title: "Backup", assignee: "Sara", status: "DONE", dueDate: null }] },
    readiness: { total: 6, resolved: 6, percent: 100, items: [] },
    validation: { total: 4, passed: 3, failed: 1, items: [{ domain: "DATABASE", result: "FAILED", note: "Row counts differ" }] },
    activity: { notes: 1, openIssues: 1, issues: [{ text: "Disk full", severity: "HIGH", state: "OPEN", resolutionNote: null }] },
  };

  test("is empty until the request is completed", () => {
    render(<ReportTab status="VALIDATION" report={{ kind: "idle" }} retry={vi.fn()} />);
    expect(screen.getByText(/created when the request is completed/)).toBeTruthy();
  });

  test("shows the snapshot", () => {
    render(<ReportTab status="COMPLETED" report={{ kind: "ready", data: report }} retry={vi.fn()} />);
    expect(screen.getByText("REQ-0001 – Patch DB")).toBeTruthy();
    expect(screen.getByText("Patched without downtime")).toBeTruthy();
    expect(screen.getByText("One slow query")).toBeTruthy();
    expect(screen.getByText(/Database: Failed – Row counts differ/)).toBeTruthy();
    expect(screen.getByText(/HIGH · OPEN: Disk full/)).toBeTruthy();
    expect(screen.getByText(/Tasks \(1 of 2 done\)/)).toBeTruthy();
  });

  test("a load error offers a retry", () => {
    const retry = vi.fn();
    render(<ReportTab status="COMPLETED" report={{ kind: "error", message: "boom" }} retry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalled();
  });
});

describe("API contract", () => {
  test("validation, report and closing use the documented method, path and body", async () => {
    vi.unstubAllGlobals();
    const calls: { url: string; method: string; body: unknown }[] = [];
    configureClient({ getToken: async () => "t", onUnauthorized: () => {} });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
      return new Response("{}", { status: 200 });
    }));
    const v = await vi.importActual<typeof import("../api/validation")>("../api/validation");
    const r = await vi.importActual<typeof import("../api/requests")>("../api/requests");
    await v.getValidation("R1");
    await v.setResult("R1", "DATABASE", 2, "FAILED", "bad");
    await v.getReport("R1");
    await r.transitionRequest("R1", "COMPLETED", 9, { summary: "Done", remainingIssues: "x" });
    await r.transitionRequest("R1", "SCHEDULED", 3);
    const B = "https://api.test/v1/requests/R1";
    expect(calls).toEqual([
      { url: `${B}/validation`, method: "GET", body: undefined },
      { url: `${B}/validation/DATABASE`, method: "PATCH", body: { version: 2, result: "FAILED", note: "bad" } },
      { url: `${B}/report`, method: "GET", body: undefined },
      { url: `${B}/transition`, method: "POST", body: { to: "COMPLETED", version: 9, summary: "Done", remainingIssues: "x" } },
      { url: `${B}/transition`, method: "POST", body: { to: "SCHEDULED", version: 3 } },
    ]);
    vi.unstubAllGlobals();
  });
});
