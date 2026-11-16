import { api } from "./client";

/* Notifications (docs/backend/api-specification.md 3.15, 13). Always the caller's own notifications. */
export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  /** null when the recipient no longer has access to the request (for example, after being removed). */
  requestId: string | null;
  requestNo: string;
  createdAt: string;
  readAt: string | null;
}

export const listNotifications = (p: { unread?: boolean; limit?: number; nextToken?: string } = {}, signal?: AbortSignal) =>
  api<{ items: NotificationItem[]; nextToken: string | null }>("notifications", {
    query: { unread: p.unread ? "true" : undefined, limit: p.limit, nextToken: p.nextToken },
    signal,
  });

export const getUnreadCount = (signal?: AbortSignal) => api<{ count: number }>("notifications/unread-count", { signal });

export const markNotificationRead = (id: string) => api<void>(`notifications/${encodeURIComponent(id)}/read`, { method: "POST" });

export const markAllNotificationsRead = () => api<void>("notifications/read-all", { method: "POST" });
