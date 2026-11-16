import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../config", () => ({ config: { apiEnabled: true, apiBaseUrl: "https://api.test/v1", userPoolId: "p", clientId: "c" } }));
vi.mock("../api/notifications", async (orig) => ({
  ...(await orig<typeof import("../api/notifications")>()),
  getUnreadCount: vi.fn(),
  listNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));

import * as api from "../api/notifications";
import NotificationBell, { POLL_MS } from "../components/NotificationBell";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => vi.clearAllMocks());

const n = (o: Partial<api.NotificationItem>): api.NotificationItem => ({
  id: "01JD00000000000000000000A1", type: "APPROVAL_REQUIRED", title: "Approval required: REQ-0001", body: "Owner submitted REQ-0001 – Patch DB for your approval.",
  requestId: "R1", requestNo: "REQ-0001", createdAt: "2026-11-12T10:00:00Z", readAt: null, ...o,
});

const renderBell = () =>
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<NotificationBell />} />
        <Route path="/requests/:id" element={<p>request page</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe("NotificationBell", () => {
  test("red dot only when there are unread notifications", async () => {
    vi.mocked(api.getUnreadCount).mockResolvedValue({ count: 0 });
    const { container, unmount } = renderBell();
    await waitFor(() => expect(api.getUnreadCount).toHaveBeenCalled());
    expect(container.querySelector(".bell i")).toBeNull();
    unmount();

    vi.mocked(api.getUnreadCount).mockResolvedValue({ count: 3 });
    const second = renderBell();
    await waitFor(() => expect(screen.getByRole("button", { name: "Notifications, 3 unread" })).toBeTruthy());
    expect(second.container.querySelector(".bell i")).not.toBeNull();
  });

  test("polls the unread count every 60 seconds while visible", async () => {
    vi.useFakeTimers();
    vi.mocked(api.getUnreadCount).mockResolvedValue({ count: 0 });
    renderBell();
    expect(api.getUnreadCount).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(POLL_MS));
    expect(api.getUnreadCount).toHaveBeenCalledTimes(2);
  });

  test("opening lists notifications; clicking one marks it read and opens the request", async () => {
    vi.mocked(api.getUnreadCount).mockResolvedValue({ count: 1 });
    vi.mocked(api.listNotifications).mockResolvedValue({ items: [n({})], nextToken: null });
    vi.mocked(api.markNotificationRead).mockResolvedValue(undefined);
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));
    expect(api.listNotifications).toHaveBeenCalledWith({ limit: 20 }, expect.anything());
    fireEvent.click(await screen.findByRole("button", { name: "Unread: Approval required: REQ-0001" }));
    expect(api.markNotificationRead).toHaveBeenCalledWith("01JD00000000000000000000A1");
    await waitFor(() => expect(screen.getByText("request page")).toBeTruthy());
  });

  test("a notification without access (removed) has no link: it is only marked read", async () => {
    vi.mocked(api.getUnreadCount).mockResolvedValue({ count: 1 });
    vi.mocked(api.listNotifications).mockResolvedValue({ items: [n({ type: "MEMBER_REMOVED", title: "You were removed from REQ-0001", requestId: null })], nextToken: null });
    vi.mocked(api.markNotificationRead).mockResolvedValue(undefined);
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: /Notifications/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Unread: You were removed from REQ-0001" }));
    expect(api.markNotificationRead).toHaveBeenCalled();
    expect(screen.queryByText("request page")).toBeNull();
  });

  test("mark all read; empty and error states", async () => {
    vi.mocked(api.getUnreadCount).mockResolvedValue({ count: 2 });
    vi.mocked(api.listNotifications).mockResolvedValue({ items: [n({}), n({ id: "01JD00000000000000000000A2", title: "Second" })], nextToken: null });
    vi.mocked(api.markAllNotificationsRead).mockResolvedValue(undefined);
    const { container } = renderBell();
    fireEvent.click(await screen.findByRole("button", { name: /Notifications/ }));
    const readAllButton = await screen.findByRole("button", { name: "Mark all read" });
    await act(async () => fireEvent.click(readAllButton));
    expect(api.markAllNotificationsRead).toHaveBeenCalled();
    expect(container.querySelector(".bell i")).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark all read" })).toBeNull();
    cleanup();

    vi.mocked(api.getUnreadCount).mockResolvedValue({ count: 0 });
    vi.mocked(api.listNotifications).mockResolvedValue({ items: [], nextToken: null });
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: "Notifications" }));
    expect(await screen.findByText("You have no notifications.")).toBeTruthy();
    cleanup();

    const { ApiClientError } = await import("../api/client");
    vi.mocked(api.listNotifications).mockRejectedValue(new ApiClientError(500, "INTERNAL_ERROR", "The server had a problem. Please try again."));
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: "Notifications" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/server had a problem/);
  });

  test("Escape closes the panel", async () => {
    vi.mocked(api.getUnreadCount).mockResolvedValue({ count: 0 });
    vi.mocked(api.listNotifications).mockResolvedValue({ items: [], nextToken: null });
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: "Notifications" }));
    expect(screen.getByRole("dialog", { name: "Notifications" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
