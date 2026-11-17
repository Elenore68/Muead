import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

vi.mock("../config", () => ({ config: { apiEnabled: true, apiBaseUrl: "https://api.test/v1", userPoolId: "p", clientId: "c" } }));
const auth = { profile: { id: "u1", email: "sara@example.test", displayName: "Sara", initials: "Sa", roles: ["ApprovalEligible"], notificationPrefs: { email: true } }, signOut: vi.fn(), reloadProfile: vi.fn(async () => {}) };
vi.mock("../auth/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("../components/NotificationBell", () => ({ default: () => null }));
vi.mock("../api/me", async (orig) => ({ ...(await orig<typeof import("../api/me")>()), updateMe: vi.fn() }));
vi.mock("../api/members", async (orig) => ({ ...(await orig<typeof import("../api/members")>()), searchUsers: vi.fn() }));
vi.mock("../api/requests", async (orig) => ({ ...(await orig<typeof import("../api/requests")>()), listRequests: vi.fn() }));
import * as meApi from "../api/me";
import * as membersApi from "../api/members";
import * as reqApi from "../api/requests";
import { configureClient } from "../api/client";
import { csvCell, toCsv } from "../data/csv";
import Settings from "../pages/Settings";
import Team from "../pages/Team";
import Reports from "../pages/Reports";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});
const wrap = (el: ReactElement) => render(<MemoryRouter>{el}</MemoryRouter>);

describe("csv", () => {
  test("escapes quotes, commas and line breaks", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(42)).toBe("42");
  });
  test("neutralises spreadsheet formulas", () => {
    for (const v of ["=1+1", "+cmd|' /C calc'!A0", "-2+3", "@SUM(A1)", "\tx"]) expect(csvCell(v).replace(/^"/, "").startsWith("'")).toBe(true);
    expect(csvCell("normal -dash")).toBe("normal -dash");
  });
  test("rows use CRLF and keep Arabic text", () => {
    expect(toCsv(["a", "b"], [["1", "طلب"], ["=x", "y"]])).toBe("a,b\r\n1,طلب\r\n'=x,y");
  });
});

describe("Settings", () => {
  test("saving sends only what changed, then reloads the profile", async () => {
    vi.mocked(meApi.updateMe).mockResolvedValue({} as any);
    wrap(<Settings />);
    const save = screen.getByRole("button", { name: /save changes/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  Sara A  " } });
    fireEvent.click(screen.getByLabelText(/email notifications/i));
    fireEvent.click(save);
    await waitFor(() => expect(meApi.updateMe).toHaveBeenCalledWith({ displayName: "Sara A", notificationPrefs: { email: false } }));
    await waitFor(() => expect(auth.reloadProfile).toHaveBeenCalled());
    expect((await screen.findByRole("status")).textContent).toMatch(/saved/);
  });

  test("only the preference changed -> only the preference is sent", async () => {
    vi.mocked(meApi.updateMe).mockResolvedValue({} as any);
    wrap(<Settings />);
    fireEvent.click(screen.getByLabelText(/email notifications/i));
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(meApi.updateMe).toHaveBeenCalledWith({ notificationPrefs: { email: false } }));
  });

  test("an empty name is refused; a server error is shown", async () => {
    wrap(<Settings />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/cannot be empty/);
    expect(meApi.updateMe).not.toHaveBeenCalled();
    vi.mocked(meApi.updateMe).mockRejectedValue(new Error("displayName must be 1-80 characters"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ok" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/1-80/));
  });

  test("shows the email read-only and the access level; sign out works", () => {
    wrap(<Settings />);
    expect((screen.getByLabelText("Email") as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByText(/Can be assigned as an approver/)).toBeTruthy();
    fireEvent.click(within(screen.getByLabelText("Name").closest("form")!).getByRole("button", { name: /sign out/i }));
    expect(auth.signOut).toHaveBeenCalled();
  });
});

describe("Team", () => {
  test("waits for two letters, then searches with the approver filter", async () => {
    vi.mocked(membersApi.searchUsers).mockResolvedValue({ items: [{ id: "u2", displayName: "Amal", initials: "Am", approvalEligible: true }, { id: "u3", displayName: "Amira", initials: "Ar", approvalEligible: false }], nextToken: null });
    wrap(<Team />);
    fireEvent.change(screen.getByLabelText("Search by name"), { target: { value: "a" } });
    expect(membersApi.searchUsers).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Search by name"), { target: { value: "am" } });
    expect(await screen.findByText("Amal")).toBeTruthy();
    expect(membersApi.searchUsers).toHaveBeenCalledWith({ q: "am", approverEligible: false, limit: 50 }, expect.anything());
    expect(screen.getAllByText("Can approve").length).toBe(1);
    expect(document.body.textContent).not.toMatch(/@/);
    fireEvent.click(screen.getByLabelText(/can approve requests/i));
    await waitFor(() => expect(membersApi.searchUsers).toHaveBeenLastCalledWith({ q: "am", approverEligible: true, limit: 50 }, expect.anything()));
  });

  test("empty and error states", async () => {
    vi.mocked(membersApi.searchUsers).mockResolvedValueOnce({ items: [], nextToken: null }).mockRejectedValueOnce(new Error("boom"));
    wrap(<Team />);
    fireEvent.change(screen.getByLabelText("Search by name"), { target: { value: "zz" } });
    expect(await screen.findByText(/No one matches/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search by name"), { target: { value: "zzz" } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/boom/);
  });
});

describe("Reports", () => {
  const row = (o: Partial<reqApi.RequestSummary> = {}): reqApi.RequestSummary => ({
    id: "R1", requestNo: "REQ-0001", title: "=Patch DB", status: "COMPLETED", owner: { id: "u1", displayName: "Owner", initials: "Ow" }, category: "IT", priority: "HIGH",
    schedule: { start: "2026-12-01T00:00:00Z", end: null, timezone: null }, createdAt: "2026-11-10T00:00:00Z", updatedAt: "2026-12-02T00:00:00Z", version: 3, ...o,
  });

  test("lists completed requests with a link that opens the Report tab", async () => {
    vi.mocked(reqApi.listRequests).mockResolvedValue({ items: [row()], nextToken: null });
    wrap(<Reports />);
    expect(await screen.findByText("REQ-0001")).toBeTruthy();
    expect(reqApi.listRequests).toHaveBeenCalledWith({ status: "COMPLETED", q: undefined, limit: 20, nextToken: undefined }, expect.anything());
    expect(screen.getByRole("link", { name: "Open report" }).getAttribute("href")).toBe("/requests/R1");
  });

  test("switching to cancelled reloads from the first page", async () => {
    vi.mocked(reqApi.listRequests).mockResolvedValue({ items: [], nextToken: null });
    wrap(<Reports />);
    await screen.findByText(/Nothing here yet/);
    fireEvent.change(screen.getByLabelText("Show"), { target: { value: "CANCELLED" } });
    await waitFor(() => expect(reqApi.listRequests).toHaveBeenLastCalledWith({ status: "CANCELLED", q: undefined, limit: 20, nextToken: undefined }, expect.anything()));
  });

  test("paging keeps the continuation tokens", async () => {
    vi.mocked(reqApi.listRequests)
      .mockResolvedValueOnce({ items: [row()], nextToken: "T2" })
      .mockResolvedValueOnce({ items: [row({ id: "R2", requestNo: "REQ-0002" })], nextToken: null })
      .mockResolvedValueOnce({ items: [row()], nextToken: "T2" });
    wrap(<Reports />);
    await screen.findByText("REQ-0001");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("REQ-0002");
    expect(reqApi.listRequests).toHaveBeenLastCalledWith(expect.objectContaining({ nextToken: "T2" }), expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await screen.findByText("REQ-0001");
  });

  test("the CSV export downloads what is on the page, with formulas neutralised", async () => {
    vi.mocked(reqApi.listRequests).mockResolvedValue({ items: [row()], nextToken: null });
    let blob: Blob | undefined;
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: (b: Blob) => ((blob = b), "blob:x"), revokeObjectURL: () => {} }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    wrap(<Reports />);
    await screen.findByText("REQ-0001");
    fireEvent.click(screen.getByRole("button", { name: /download csv/i }));
    expect(click).toHaveBeenCalled();
    const text = await new Promise<string>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.readAsText(blob!);
    });
    const bytes = await new Promise<Uint8Array>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(new Uint8Array(fr.result as ArrayBuffer));
      fr.readAsArrayBuffer(blob!);
    });
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM so Excel reads Arabic
    expect(text).toMatch(/^Request,Title,Status/);
    expect(text).toContain("REQ-0001,'=Patch DB,Completed,Owner,IT,HIGH");
    click.mockRestore();
    vi.unstubAllGlobals();
  });

  test("an error offers a retry", async () => {
    vi.mocked(reqApi.listRequests).mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ items: [], nextToken: null });
    wrap(<Reports />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/boom/);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByText(/Nothing here yet/)).toBeTruthy();
  });
});

describe("API contract", () => {
  test("PATCH /me", async () => {
    vi.unstubAllGlobals();
    const calls: { url: string; method: string; body: unknown }[] = [];
    configureClient({ getToken: async () => "t", onUnauthorized: () => {} });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
      return new Response("{}", { status: 200 });
    }));
    const real = await vi.importActual<typeof import("../api/me")>("../api/me");
    await real.updateMe({ notificationPrefs: { email: false } });
    expect(calls).toEqual([{ url: "https://api.test/v1/me", method: "PATCH", body: { notificationPrefs: { email: false } } }]);
    vi.unstubAllGlobals();
  });
});
