import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../config", () => ({ config: { apiEnabled: true, apiBaseUrl: "https://api.test/v1", userPoolId: "p", clientId: "c" } }));
vi.mock("../api/requests", async (orig) => ({
  ...(await orig<typeof import("../api/requests")>()),
  transitionRequest: vi.fn(),
  cancelRequest: vi.fn(),
  updateRequest: vi.fn(),
  getReferenceData: vi.fn(async () => ({ categories: ["IT"], priorities: [] })),
}));
import * as api from "../api/requests";
import { ApiClientError, configureClient } from "../api/client";
import LifecycleCard from "../components/LifecycleCard";
import { EMPTY_VALUES, parseLinks, toFieldsInput } from "../components/RequestFields";
import { canEditRequest, lifecycleActions, type Viewer } from "../data/permissions";
import { advanceLabel, LIFECYCLE_STEPS, stageLabel } from "../api/labels";

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const viewer = (o: Partial<Viewer> = {}): Viewer => ({ activityRole: "OWNER", canEdit: true, canManageMembers: true, lifecycle: { next: "SCHEDULED", canCancel: true }, ...o });
const card = (o: Partial<Parameters<typeof LifecycleCard>[0]> = {}) => {
  const props = { requestId: "R1", status: "APPROVED" as const, version: 7, viewer: viewer(), fields: EMPTY_VALUES, onChanged: vi.fn(), notify: vi.fn(), ...o };
  render(<LifecycleCard {...props} />);
  return props;
};

describe("lifecycle labels and permissions", () => {
  test("the stepper path matches the confirmed lifecycle, with Approved as its own step", () => {
    expect(LIFECYCLE_STEPS.map(stageLabel)).toEqual(["Draft", "Pending Approval", "Approved", "Scheduled", "Readiness", "In Progress", "Validation", "Completed"]);
    expect(advanceLabel("IN_PROGRESS")).toBe("Start maintenance");
  });
  test("what is offered comes from the backend: nothing without viewer.lifecycle", () => {
    expect(lifecycleActions(undefined)).toEqual({ next: null, canCancel: false });
    expect(lifecycleActions(viewer({ lifecycle: undefined }))).toEqual({ next: null, canCancel: false });
  });
  test("editing: owner or admin, DRAFT / REJECTED only", () => {
    expect(canEditRequest(viewer(), "DRAFT")).toBe(true);
    expect(canEditRequest(viewer(), "REJECTED")).toBe(true);
    for (const s of ["PENDING_APPROVAL", "APPROVED", "SCHEDULED", "COMPLETED", "CANCELLED"] as const) expect(canEditRequest(viewer(), s)).toBe(false);
    expect(canEditRequest(viewer({ canEdit: false }), "DRAFT")).toBe(false);
  });
});

describe("form values", () => {
  test("links: one http(s) URL per line; bad lines are reported", () => {
    expect(parseLinks("https://a.example/x\n\n http://b.example ").links.map((l) => l.url)).toEqual(["https://a.example/x", "http://b.example"]);
    expect(parseLinks("not a url").error).toMatch(/not a valid link/);
    expect(parseLinks("javascript:alert(1)").error).toMatch(/http/);
  });
  test("toFieldsInput maps dates, systems and the dropdowns; end must be after start", () => {
    const base = { ...EMPTY_VALUES, title: " T ", description: "D", environment: "Staging", cloudPlatform: "AWS", maintenanceType: "Patching", affectedSystems: "a, b ,", start: "2026-12-01" };
    const { input } = toFieldsInput(base);
    expect(input).toMatchObject({ title: "T", environment: "Staging", cloudPlatform: "AWS", maintenanceType: "Patching", affectedSystems: ["a", "b"] });
    expect(input?.schedule?.start).toBe(new Date("2026-12-01T00:00:00").toISOString());
    expect(toFieldsInput({ ...base, end: "2026-11-30" }).error).toMatch(/after the start/);
    expect(toFieldsInput({ ...EMPTY_VALUES, end: "2026-12-01" }).error).toMatch(/start date/);
  });
});

describe("LifecycleCard", () => {
  test("shows the current step and the next-step button; clicking moves exactly one step with the version", async () => {
    vi.mocked(api.transitionRequest).mockResolvedValue({ requestId: "R1", status: "SCHEDULED", previousStatus: "APPROVED", version: 8 });
    const p = card();
    expect(screen.getByText("Approved").closest("li")?.getAttribute("aria-current")).toBe("step");
    fireEvent.click(screen.getByRole("button", { name: /mark as scheduled/i }));
    await waitFor(() => expect(p.onChanged).toHaveBeenCalled());
    expect(api.transitionRequest).toHaveBeenCalledWith("R1", "SCHEDULED", 7);
    expect(p.notify).toHaveBeenCalledWith("success", expect.stringContaining("Scheduled"));
  });

  test("a backend refusal is shown and the page reloads", async () => {
    vi.mocked(api.transitionRequest).mockRejectedValue(new ApiClientError(409, "VERSION_CONFLICT", "The request was changed by someone else."));
    const p = card();
    fireEvent.click(screen.getByRole("button", { name: /mark as scheduled/i }));
    await waitFor(() => expect(p.notify).toHaveBeenCalledWith("error", expect.stringContaining("changed by someone else")));
    expect(p.onChanged).toHaveBeenCalled();
  });

  test("participants (no actions) and finished requests get no buttons", () => {
    card({ viewer: viewer({ canEdit: false, lifecycle: { next: null, canCancel: false } }) });
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    card({ status: "COMPLETED", viewer: viewer({ lifecycle: { next: null, canCancel: false } }) });
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("cancel needs a reason, then calls the API with the version", async () => {
    vi.mocked(api.cancelRequest).mockResolvedValue({ requestId: "R1", status: "CANCELLED", version: 8 });
    const p = card();
    fireEvent.click(screen.getByRole("button", { name: /cancel request/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog.querySelector("button[type=submit]")!);
    expect((await screen.findByRole("alert")).textContent).toMatch(/reason is required/i);
    expect(api.cancelRequest).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "Freeze window" } });
    fireEvent.click(dialog.querySelector("button[type=submit]")!);
    await waitFor(() => expect(api.cancelRequest).toHaveBeenCalledWith("R1", "Freeze window", 7));
    await waitFor(() => expect(p.onChanged).toHaveBeenCalled());
  });

  test("Edit is offered for a draft only, and saves with the version", async () => {
    vi.mocked(api.updateRequest).mockResolvedValue({ id: "R1", version: 2 });
    const fields = { ...EMPTY_VALUES, title: "Old", description: "Desc" };
    const p = card({ status: "DRAFT", version: 1, fields, viewer: viewer({ lifecycle: { next: null, canCancel: true } }) });
    fireEvent.click(screen.getByRole("button", { name: /edit request/i }));
    fireEvent.change(await screen.findByLabelText(/^Title/), { target: { value: "New title" } });
    fireEvent.change(screen.getByLabelText(/Environment/), { target: { value: "Staging" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(api.updateRequest).toHaveBeenCalled());
    const [id, version, body] = vi.mocked(api.updateRequest).mock.calls[0];
    expect([id, version]).toEqual(["R1", 1]);
    expect(body).toMatchObject({ title: "New title", environment: "Staging" });
    await waitFor(() => expect(p.onChanged).toHaveBeenCalled());
  });

  test("cancelled requests show the reason and no actions", () => {
    card({ status: "CANCELLED", cancelReason: "Freeze window", viewer: viewer({ lifecycle: { next: null, canCancel: false } }) });
    expect(screen.getByText(/Freeze window/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("API contract", () => {
  test("transition, cancel and update use the documented method, path and body", async () => {
    vi.unstubAllGlobals();
    const calls: { url: string; method: string; body: unknown }[] = [];
    configureClient({ getToken: async () => "t", onUnauthorized: () => {} });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
      return new Response("{}", { status: 200 });
    }));
    const real = await vi.importActual<typeof import("../api/requests")>("../api/requests");
    await real.transitionRequest("R1", "READINESS", 3);
    await real.cancelRequest("R1", "why", 3);
    await real.updateRequest("R1", 3, { scope: "s" });
    expect(calls).toEqual([
      { url: "https://api.test/v1/requests/R1/transition", method: "POST", body: { to: "READINESS", version: 3 } },
      { url: "https://api.test/v1/requests/R1/cancel", method: "POST", body: { reason: "why", version: 3 } },
      { url: "https://api.test/v1/requests/R1", method: "PATCH", body: { scope: "s", version: 3 } },
    ]);
    vi.unstubAllGlobals();
  });
});
