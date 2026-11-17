import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("../config", () => ({ config: { apiEnabled: true, apiBaseUrl: "https://api.test/v1", userPoolId: "p", clientId: "c" } }));
vi.mock("../api/readiness", async (orig) => ({ ...(await orig<typeof import("../api/readiness")>()), updateItem: vi.fn(), addItem: vi.fn(), deleteItem: vi.fn() }));
import * as api from "../api/readiness";
import { ApiClientError, configureClient } from "../api/client";
import type { ChecklistItem, Readiness } from "../api/readiness";
import ReadinessTab from "../components/ReadinessTab";
import { canManageChecklist, canUpdateChecklist, type Viewer } from "../data/permissions";

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const owner: Viewer = { activityRole: "OWNER", canEdit: true, canManageMembers: true };
const participant: Viewer = { activityRole: "PARTICIPANT", canEdit: false, canManageMembers: false };
const approver: Viewer = { activityRole: "APPROVER", canEdit: false, canManageMembers: false };
const item = (o: Partial<ChecklistItem> = {}): ChecklistItem => ({
  id: "I1", group: "BACKUP", title: "Backups are taken", custom: false, state: "PENDING", note: null, updatedBy: null, updatedAt: "2026-11-12T00:00:00Z", version: 1, ...o,
});
const ready = (items: ChecklistItem[], started = true): { kind: "ready"; data: Readiness } => {
  const resolved = items.filter((i) => i.state !== "PENDING").length;
  return { kind: "ready", data: { items, started, requestStatus: "READINESS", progress: { total: items.length, resolved, done: 0, percent: items.length ? Math.round((resolved / items.length) * 100) : 0 } } };
};
const props = (o: Partial<Parameters<typeof ReadinessTab>[0]> = {}) => ({
  requestId: "R1", status: "READINESS" as const, viewer: owner, readiness: ready([item(), item({ id: "I2", group: "ACCESS", title: "Access ok", custom: true })]),
  retry: vi.fn(), onChanged: vi.fn(), notify: vi.fn(), ...o,
});

describe("checklist permissions", () => {
  test("owner, admin and participants update during Readiness only; approvers never", () => {
    expect(canUpdateChecklist(owner, "READINESS")).toBe(true);
    expect(canUpdateChecklist(participant, "READINESS")).toBe(true);
    expect(canUpdateChecklist(approver, "READINESS")).toBe(false);
    expect(canUpdateChecklist(owner, "SCHEDULED")).toBe(false);
    expect(canUpdateChecklist(owner, "IN_PROGRESS")).toBe(false);
  });
  test("only the owner or admin manage custom items", () => {
    expect(canManageChecklist(owner, "READINESS")).toBe(true);
    expect(canManageChecklist(participant, "READINESS")).toBe(false);
    expect(canManageChecklist(owner, "COMPLETED")).toBe(false);
  });
});

describe("ReadinessTab", () => {
  test("before the stage starts it explains when the checklist appears", () => {
    render(<ReadinessTab {...props({ status: "APPROVED", readiness: ready([], false) })} />);
    expect(screen.getByText(/created when the request moves to Readiness/)).toBeTruthy();
  });

  test("shows groups, progress and the gate message", () => {
    render(<ReadinessTab {...props({ readiness: ready([item({ state: "DONE" }), item({ id: "I2", group: "ACCESS", title: "Access ok" })]) })} />);
    expect(screen.getByText("1 of 2 items resolved (50%)")).toBeTruthy();
    expect(screen.getByText("Backup")).toBeTruthy();
    expect(screen.getByText("Access")).toBeTruthy();
    expect(screen.getByText(/cannot start until every item/)).toBeTruthy();
  });

  test("a participant marks an item done with its version", async () => {
    vi.mocked(api.updateItem).mockResolvedValue(item({ state: "DONE", version: 2 }));
    const p = props({ viewer: participant });
    render(<ReadinessTab {...p} />);
    expect(screen.queryByRole("button", { name: /add item/i })).toBeNull();
    fireEvent.change(screen.getByLabelText("State of Backups are taken"), { target: { value: "DONE" } });
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledWith("R1", "I1", 1, "DONE", undefined));
    await waitFor(() => expect(p.onChanged).toHaveBeenCalled());
  });

  test("an approver only reads", () => {
    render(<ReadinessTab {...props({ viewer: approver })} />);
    expect(screen.queryByLabelText("State of Backups are taken")).toBeNull();
    expect(screen.getAllByText("Pending").length).toBeGreaterThan(0);
  });

  test("not applicable needs a reason", async () => {
    vi.mocked(api.updateItem).mockResolvedValue(item({ state: "NOT_APPLICABLE", note: "No DB", version: 2 }));
    render(<ReadinessTab {...props()} />);
    fireEvent.change(screen.getByLabelText("State of Backups are taken"), { target: { value: "NOT_APPLICABLE" } });
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog.querySelector("button[type=submit]")!);
    expect((await screen.findByRole("alert")).textContent).toMatch(/reason is required/i);
    expect(api.updateItem).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "No DB" } });
    fireEvent.click(dialog.querySelector("button[type=submit]")!);
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledWith("R1", "I1", 1, "NOT_APPLICABLE", "No DB"));
  });

  test("a refused change is reported and the list reloads", async () => {
    vi.mocked(api.updateItem).mockRejectedValue(new ApiClientError(409, "VERSION_CONFLICT", "The item was changed by someone else."));
    const p = props();
    render(<ReadinessTab {...p} />);
    fireEvent.change(screen.getByLabelText("State of Backups are taken"), { target: { value: "DONE" } });
    await waitFor(() => expect(p.notify).toHaveBeenCalledWith("error", expect.stringContaining("changed by someone else")));
    expect(p.onChanged).toHaveBeenCalled();
  });

  test("only custom items can be deleted, by the owner", async () => {
    vi.mocked(api.deleteItem).mockResolvedValue(undefined);
    render(<ReadinessTab {...props()} />);
    expect(screen.queryByRole("button", { name: "Delete Backups are taken" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete Access ok" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^Delete$/ }));
    await waitFor(() => expect(api.deleteItem).toHaveBeenCalledWith("R1", "I2"));
  });

  test("owner adds a custom item", async () => {
    vi.mocked(api.addItem).mockResolvedValue(item({ id: "I3", custom: true }));
    render(<ReadinessTab {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: /add item/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^add item$/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/title is required/i);
    fireEvent.change(within(dialog).getByLabelText(/Group/), { target: { value: "DOCUMENTATION" } });
    fireEvent.change(within(dialog).getByLabelText(/Title/), { target: { value: "Rollback tested" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^add item$/i }));
    await waitFor(() => expect(api.addItem).toHaveBeenCalledWith("R1", "DOCUMENTATION", "Rollback tested"));
  });

  test("outside Readiness nothing is editable", () => {
    render(<ReadinessTab {...props({ status: "IN_PROGRESS" })} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByLabelText("State of Backups are taken")).toBeNull();
  });
});

describe("API contract", () => {
  test("readiness calls use the documented method, path and body", async () => {
    vi.unstubAllGlobals();
    const calls: { url: string; method: string; body: unknown }[] = [];
    configureClient({ getToken: async () => "t", onUnauthorized: () => {} });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
      return new Response("{}", { status: 200 });
    }));
    const real = await vi.importActual<typeof import("../api/readiness")>("../api/readiness");
    await real.getReadiness("R1");
    await real.updateItem("R1", "I1", 2, "NOT_APPLICABLE", "why");
    await real.updateItem("R1", "I1", 2, "DONE");
    await real.addItem("R1", "BACKUP", "x");
    await real.deleteItem("R1", "I1");
    const B = "https://api.test/v1/requests/R1/readiness";
    expect(calls).toEqual([
      { url: B, method: "GET", body: undefined },
      { url: `${B}/I1`, method: "PATCH", body: { version: 2, state: "NOT_APPLICABLE", note: "why" } },
      { url: `${B}/I1`, method: "PATCH", body: { version: 2, state: "DONE" } },
      { url: B, method: "POST", body: { group: "BACKUP", title: "x" } },
      { url: `${B}/I1`, method: "DELETE", body: undefined },
    ]);
    vi.unstubAllGlobals();
  });
});
