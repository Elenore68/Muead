import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { errorMessage } from "../api/client";
import { formatDateTime } from "../api/labels";
import { getUnreadCount, listNotifications, markAllNotificationsRead, markNotificationRead, type NotificationItem } from "../api/notifications";

/** How often the unread count is refreshed while the tab is visible (api-specification.md 3.15: polling). */
export const POLL_MS = 60_000;
const PANEL_LIMIT = 20;

type Panel = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; items: NotificationItem[] };

/**
 * Live-mode bell. The red dot shows only when the caller has unread notifications. Clicking opens a small panel
 * (built from existing card styles; the design reference has no notification panel).
 * Mock mode keeps the original static bell in Layout.
 */
export default function NotificationBell() {
  const nav = useNavigate();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const refreshCount = useCallback((signal?: AbortSignal) => {
    getUnreadCount(signal).then(
      (r) => !signal?.aborted && setUnread(r.count),
      () => {}, // the bell is decoration: a failed poll keeps the last known state
    );
  }, []);

  // Poll while the page is visible; refresh immediately when it becomes visible again.
  useEffect(() => {
    const ac = new AbortController();
    refreshCount(ac.signal);
    const timer = setInterval(() => document.visibilityState === "visible" && refreshCount(ac.signal), POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && refreshCount(ac.signal);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      ac.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshCount]);

  // Load the list each time the panel opens.
  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    setPanel({ kind: "loading" });
    listNotifications({ limit: PANEL_LIMIT }, ac.signal).then(
      (r) => !ac.signal.aborted && setPanel({ kind: "ready", items: r.items }),
      (e) => !ac.signal.aborted && (e as Error).name !== "AbortError" && setPanel({ kind: "error", message: errorMessage(e) }),
    );
    return () => ac.abort();
  }, [open]);

  // Close on outside click and Escape (focus goes back to the bell).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const markLocal = (pred: (n: NotificationItem) => boolean) =>
    setPanel((p) => (p.kind === "ready" ? { kind: "ready", items: p.items.map((n) => (pred(n) && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n)) } : p));

  const openItem = async (n: NotificationItem) => {
    if (!n.readAt) {
      markLocal((x) => x.id === n.id);
      setUnread((c) => Math.max(0, c - 1));
      markNotificationRead(n.id).catch(() => refreshCount());
    }
    if (n.requestId) {
      setOpen(false);
      nav(`/requests/${n.requestId}`);
    }
  };

  const readAll = async () => {
    setBusy(true);
    try {
      await markAllNotificationsRead();
      markLocal(() => true);
      setUnread(0);
    } catch (e) {
      setPanel({ kind: "error", message: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications";
  return (
    <div className="notif-wrap" ref={wrap}>
      <button ref={button} className="bell" aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Bell size={22} />
        {unread > 0 && <i />}
      </button>
      {open && (
        <div className="card notif-panel" role="dialog" aria-label="Notifications">
          <div className="card-head">
            <h2 className="card-title">Notifications</h2>
            {panel.kind === "ready" && panel.items.some((n) => !n.readAt) && (
              <button type="button" className="link notif-readall" onClick={readAll} disabled={busy}>{busy ? "Marking…" : "Mark all read"}</button>
            )}
          </div>
          {panel.kind === "loading" && <p className="cell-sub" role="status">Loading…</p>}
          {panel.kind === "error" && <p role="alert" className="notice error">{panel.message}</p>}
          {panel.kind === "ready" && panel.items.length === 0 && <p className="cell-sub">You have no notifications.</p>}
          {panel.kind === "ready" && panel.items.length > 0 && (
            <ul className="notif-list" aria-label="Notification list">
              {panel.items.map((n) => (
                <li key={n.id}>
                  <button type="button" className={`notif-item ${n.readAt ? "" : "unread"}`} onClick={() => openItem(n)}
                    aria-label={`${n.readAt ? "" : "Unread: "}${n.title}`}>
                    <b>{n.title}</b>
                    <span>{n.body}</span>
                    <small className="cell-sub">{formatDateTime(n.createdAt)}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
