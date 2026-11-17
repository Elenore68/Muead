import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../config", () => ({ config: { apiEnabled: true, apiBaseUrl: "https://api.test/v1", userPoolId: "p", clientId: "c" } }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ profile: { id: "u1", email: "x", displayName: "Sara", initials: "Sa", roles: [] }, signOut: () => {} }) }));
vi.mock("../components/NotificationBell", () => ({ default: () => null }));
vi.mock("../api/schedule", async (orig) => ({ ...(await orig<typeof import("../api/schedule")>()), getSchedule: vi.fn() }));
import * as api from "../api/schedule";
import { configureClient } from "../api/client";
import type { ConflictsResponse, ScheduleItem, ScheduleResponse } from "../api/schedule";
import Schedule, { monthRange } from "../pages/Schedule";
import ConflictsCard from "../components/ConflictsCard";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

const item = (o: Partial<ScheduleItem> = {}): ScheduleItem => ({
  requestId: "R1", requestNo: "REQ-0001", title: "Patch DB", status: "SCHEDULED", start: "2026-12-10T09:00:00.000Z", end: "2026-12-10T13:00:00.000Z",
  environment: "Production", owner: { id: "u1", displayName: "Owner", initials: "Ow" }, conflictCount: 0, ...o,
});
const response = (items: ScheduleItem[], extra: Partial<ScheduleResponse> = {}): ScheduleResponse => ({
  from: "2026-12-01", to: "2026-12-31", items, conflicts: items.filter((i) => i.conflictCount > 0).length, truncated: false, ...extra,
});
const page = () => render(<MemoryRouter><Schedule /></MemoryRouter>);

describe("monthRange", () => {
  test("first and last day of a month, including leap years", () => {
    expect(monthRange(2026, 11)).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(monthRange(2027, 1)).toEqual({ from: "2027-02-01", to: "2027-02-28" });
    expect(monthRange(2028, 1)).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
});

describe("Schedule page", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-05T10:00:00Z"));
  });

  test("loads the current month and groups activities by day, in order", async () => {
    vi.mocked(api.getSchedule).mockResolvedValue(response([
      item({ requestId: "R2", requestNo: "REQ-0002", title: "Later", start: "2026-12-20T09:00:00.000Z" }),
      item(),
      item({ requestId: "R3", requestNo: "REQ-0003", title: "Same day", start: "2026-12-10T15:00:00.000Z", end: null, environment: null }),
    ]));
    page();
    expect(await screen.findByText("REQ-0001 – Patch DB")).toBeTruthy();
    expect(api.getSchedule).toHaveBeenCalledWith({ from: "2026-12-01", to: "2026-12-31" }, expect.anything());
    expect(screen.getByRole("heading", { name: "December 2026" })).toBeTruthy();
    expect(screen.getByLabelText("Thursday, Dec 10").textContent).toMatch(/REQ-0003/);
    expect(screen.getByLabelText("Sunday, Dec 20").textContent).toMatch(/Later/);
    expect(screen.getByRole("link", { name: /REQ-0001/ }).getAttribute("href")).toBe("/requests/R1");
  });

  test("conflicts are flagged and counted", async () => {
    vi.mocked(api.getSchedule).mockResolvedValue(response([item({ conflictCount: 2 }), item({ requestId: "R2", requestNo: "REQ-0002", title: "Calm" })]));
    page();
    expect(await screen.findByText(/1 activity has a conflict/)).toBeTruthy();
    expect(screen.getByText(/2 conflicts/)).toBeTruthy();
  });

  test("month buttons load the neighbouring months", async () => {
    vi.mocked(api.getSchedule).mockResolvedValue(response([]));
    page();
    await screen.findByText(/No planned maintenance in December 2026/);
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    await waitFor(() => expect(api.getSchedule).toHaveBeenLastCalledWith({ from: "2027-01-01", to: "2027-01-31" }, expect.anything()));
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() => expect(api.getSchedule).toHaveBeenLastCalledWith({ from: "2026-11-01", to: "2026-11-30" }, expect.anything()));
  });

  test("an error offers a retry; a truncated list is announced", async () => {
    vi.mocked(api.getSchedule).mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(response([item()], { truncated: true }));
    page();
    expect((await screen.findByRole("alert")).textContent).toMatch(/boom/);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByText(/Only the first activities are shown/)).toBeTruthy();
  });
});

describe("ConflictsCard", () => {
  const ready = (data: ConflictsResponse) => ({ kind: "ready" as const, data });
  const wrap = (state: Parameters<typeof ConflictsCard>[0]["state"]) => render(<MemoryRouter><ConflictsCard state={state} retry={vi.fn()} /></MemoryRouter>);

  test("says so when nothing conflicts, or when there is no schedule yet", () => {
    wrap(ready({ scheduled: true, items: [] }));
    expect(screen.getByText(/No conflicts with other planned maintenance/)).toBeTruthy();
    cleanup();
    wrap(ready({ scheduled: false, items: [] }));
    expect(screen.getByText(/Set a start date/)).toBeTruthy();
  });

  test("shows a link and details for an activity you belong to", () => {
    wrap(ready({ scheduled: true, items: [{
      restricted: false, requestId: "R2", requestNo: "REQ-0002", title: "Other", status: "SCHEDULED", start: "2026-12-10T11:00:00.000Z", end: null, environment: "Production",
      reasons: [{ type: "SYSTEM", systems: ["orders-db"] }, { type: "PEOPLE", people: [{ id: "u3", displayName: "Sara" }], peopleCount: 1 }],
    }] }));
    expect(screen.getByRole("link", { name: /REQ-0002 – Other/ }).getAttribute("href")).toBe("/requests/R2");
    expect(screen.getByText(/system: orders-db/)).toBeTruthy();
    expect(screen.getByText(/Shared people: Sara/)).toBeTruthy();
  });

  test("a restricted conflict shows no number, title, system or person", () => {
    wrap(ready({ scheduled: true, items: [{
      restricted: true, requestId: null, requestNo: null, title: null, status: "SCHEDULED", start: "2026-12-10T11:00:00.000Z", end: null, environment: "Production",
      reasons: [{ type: "SYSTEM" }, { type: "PEOPLE", peopleCount: 2 }],
    }] }));
    expect(screen.getByText("Another maintenance")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/an affected system in common/)).toBeTruthy();
    expect(screen.getByText(/2 people work on both/)).toBeTruthy();
  });

  test("renders nothing before it is requested; errors offer a retry", () => {
    const { container } = wrap({ kind: "idle" });
    expect(container.textContent).toBe("");
    cleanup();
    const retry = vi.fn();
    render(<MemoryRouter><ConflictsCard state={{ kind: "error", message: "boom" }} retry={retry} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalled();
  });
});

describe("API contract", () => {
  test("schedule and conflicts use the documented paths and query", async () => {
    vi.unstubAllGlobals();
    const urls: string[] = [];
    configureClient({ getToken: async () => "t", onUnauthorized: () => {} });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url));
      return new Response("{}", { status: 200 });
    }));
    const real = await vi.importActual<typeof import("../api/schedule")>("../api/schedule");
    await real.getSchedule({ from: "2026-12-01", to: "2026-12-31" });
    await real.getConflicts("R1");
    expect(urls).toEqual(["https://api.test/v1/schedule?from=2026-12-01&to=2026-12-31", "https://api.test/v1/requests/R1/conflicts"]);
    vi.unstubAllGlobals();
  });
});
