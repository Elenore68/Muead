import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("../config", () => ({ config: { apiEnabled: true, apiBaseUrl: "https://api.test/v1", userPoolId: "p", clientId: "c" } }));
vi.mock("../api/activity", async (orig) => ({ ...(await orig<typeof import("../api/activity")>()), addEntry: vi.fn(), setIssueState: vi.fn() }));
import * as api from "../api/activity";
import { configureClient } from "../api/client";
import type { ActivityEntry, ActivityLog } from "../api/activity";
import ActivityTab from "../components/ActivityTab";
import { canWriteActivity, type Viewer } from "../data/permissions";

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const owner: Viewer = { activityRole: "OWNER", canEdit: true, canManageMembers: true };
const participant: Viewer = { activityRole: "PARTICIPANT", canEdit: false, canManageMembers: false };
const approver: Viewer = { activityRole: "APPROVER", canEdit: false, canManageMembers: false };
const entry = (o: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id: "E1", type: "ISSUE", text: "Disk full", severity: "HIGH", state: "OPEN", resolutionNote: null, resolvedBy: null, resolvedAt: null,
  author: { id: "u1", displayName: "Sara", activityRole: "PARTICIPANT" }, createdAt: "2026-11-12T10:00:00Z", version: 1, ...o,
});
const ready = (items: ActivityEntry[]): { kind: "ready"; data: ActivityLog } => ({
  kind: "ready",
  data: { items, requestStatus: "IN_PROGRESS", summary: { notes: items.filter((i) => i.type === "NOTE").length, issues: items.filter((i) => i.type === "ISSUE").length, openIssues: items.filter((i) => i.state === "OPEN").length, openHigh: 0 } },
});
const props = (o: Partial<Parameters<typeof ActivityTab>[0]> = {}) => ({
  requestId: "R1", status: "IN_PROGRESS" as const, viewer: owner, log: ready([entry()]), retry: vi.fn(), onChanged: vi.fn(), notify: vi.fn(), ...o,
});

describe("permissions", () => {
  test("write access: owner, admin and participants, in execution stages only", () => {
    expect(canWriteActivity(owner, "IN_PROGRESS")).toBe(true);
    expect(canWriteActivity(participant, "VALIDATION")).toBe(true);
    expect(canWriteActivity(approver, "IN_PROGRESS")).toBe(false);
    for (const s of ["APPROVED", "SCHEDULED", "READINESS", "COMPLETED", "CANCELLED"] as const) expect(canWriteActivity(owner, s)).toBe(false);
  });
});

describe("ActivityTab", () => {
  test("shows a summary and entries with severity and state", () => {
    render(<ActivityTab {...props({ log: ready([entry(), entry({ id: "E2", type: "NOTE", text: "Patch started", severity: null, state: null })]) })} />);
    expect(screen.getByLabelText("Activity summary").textContent).toBe("1 note · 1 issue · 1 open");
    expect(screen.getByText(/High issue · Open/)).toBeTruthy();
    expect(screen.getByText("Patch started")).toBeTruthy();
  });

  test("adds a progress note", async () => {
    vi.mocked(api.addEntry).mockResolvedValue(entry({ type: "NOTE" }));
    const p = props();
    render(<ActivityTab {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /add note/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/write something/i);
    fireEvent.change(screen.getByLabelText(/What happened/), { target: { value: " Patch started " } });
    fireEvent.click(screen.getByRole("button", { name: /add note/i }));
    await waitFor(() => expect(api.addEntry).toHaveBeenCalledWith("R1", { type: "NOTE", text: "Patch started" }));
    await waitFor(() => expect(p.onChanged).toHaveBeenCalled());
  });

  test("reports an issue with its severity", async () => {
    vi.mocked(api.addEntry).mockResolvedValue(entry());
    render(<ActivityTab {...props()} />);
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "ISSUE" } });
    fireEvent.change(screen.getByLabelText("Severity"), { target: { value: "HIGH" } });
    fireEvent.change(screen.getByLabelText(/What went wrong/), { target: { value: "Disk full" } });
    fireEvent.click(screen.getByRole("button", { name: /report issue/i }));
    await waitFor(() => expect(api.addEntry).toHaveBeenCalledWith("R1", { type: "ISSUE", text: "Disk full", severity: "HIGH" }));
  });

  test("resolving needs a description", async () => {
    vi.mocked(api.setIssueState).mockResolvedValue(entry({ state: "RESOLVED", version: 2 }));
    render(<ActivityTab {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: /^resolve$/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog.querySelector("button[type=submit]")!);
    expect(api.setIssueState).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/How was it resolved/), { target: { value: "Cleared logs" } });
    fireEvent.click(dialog.querySelector("button[type=submit]")!);
    await waitFor(() => expect(api.setIssueState).toHaveBeenCalledWith("R1", "E1", 1, "RESOLVED", "Cleared logs"));
  });

  test("a resolved issue can be reopened", async () => {
    vi.mocked(api.setIssueState).mockResolvedValue(entry({ version: 3 }));
    render(<ActivityTab {...props({ log: ready([entry({ state: "RESOLVED", resolutionNote: "Cleared", resolvedBy: { id: "u2", displayName: "Omar" }, version: 2 })]) })} />);
    expect(screen.getByText(/Omar: Cleared/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /reopen/i }));
    await waitFor(() => expect(api.setIssueState).toHaveBeenCalledWith("R1", "E1", 2, "OPEN"));
  });

  test("approvers and finished requests are read-only", () => {
    render(<ActivityTab {...props({ viewer: approver })} />);
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    render(<ActivityTab {...props({ status: "COMPLETED" })} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("before the maintenance starts an empty log explains itself", () => {
    render(<ActivityTab {...props({ status: "READINESS", log: ready([]) })} />);
    expect(screen.getByText(/once the maintenance is In Progress/)).toBeTruthy();
  });
});

describe("API contract", () => {
  test("activity calls use the documented method, path and body", async () => {
    vi.unstubAllGlobals();
    const calls: { url: string; method: string; body: unknown }[] = [];
    configureClient({ getToken: async () => "t", onUnauthorized: () => {} });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
      return new Response("{}", { status: 200 });
    }));
    const real = await vi.importActual<typeof import("../api/activity")>("../api/activity");
    await real.getActivity("R1");
    await real.addEntry("R1", { type: "ISSUE", text: "x", severity: "LOW" });
    await real.setIssueState("R1", "E1", 4, "RESOLVED", "fixed");
    const B = "https://api.test/v1/requests/R1/activity";
    expect(calls).toEqual([
      { url: B, method: "GET", body: undefined },
      { url: B, method: "POST", body: { type: "ISSUE", text: "x", severity: "LOW" } },
      { url: `${B}/E1`, method: "PATCH", body: { version: 4, state: "RESOLVED", note: "fixed" } },
    ]);
    vi.unstubAllGlobals();
  });
});
