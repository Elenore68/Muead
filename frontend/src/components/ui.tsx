import type { ReactNode } from "react";
import { avatarIndex, initialsOf } from "../data/mock";

/**
 * Labels shown in the UI. The first four are the original design; the others exist because the API has
 * more states (Draft, Approved, Scheduled, Cancelled). They reuse existing pill colours (no new colours).
 */
const statusClass: Record<string, string> = {
  Pending: "st-pending",
  "In Progress": "st-progress",
  Completed: "st-done",
  Rejected: "st-rejected",
  Draft: "chip",
  Approved: "st-done",
  Scheduled: "st-progress",
  Cancelled: "st-rejected",
};
const priorityClass: Record<string, string> = { High: "pr-high", Medium: "pr-medium", Low: "pr-low" };

export const StatusPill = ({ status }: { status: string }) => (
  <span className={`pill ${statusClass[status] ?? "chip"}`}>{status}</span>
);
export const PriorityPill = ({ priority }: { priority: string | null }) =>
  priority ? <span className={`pill ${priorityClass[priority] ?? "chip"}`}>{priority}</span> : <span aria-label="No priority">—</span>;
export const CategoryChip = ({ children }: { children?: ReactNode }) =>
  children ? <span className="pill chip">{children}</span> : <span aria-label="No category">—</span>;

export const Avatar = ({ name, initials, large }: { name: string; initials?: string; large?: boolean }) => (
  <span className={`avatar av-${avatarIndex(name)} ${large ? "lg" : ""}`} aria-hidden="true">
    {initials ?? initialsOf(name)}
  </span>
);
export const Person = ({ name, initials }: { name: string; initials?: string }) => (
  <span className="who">
    <Avatar name={name} initials={initials} />
    {name}
  </span>
);

export const Tabs = ({ items, active, onChange }: { items: string[]; active: string; onChange: (v: string) => void }) => (
  <div className="tabs" role="tablist">
    {items.map((t) => (
      <button key={t} role="tab" aria-selected={t === active} className={`tab ${t === active ? "active" : ""}`} onClick={() => onChange(t)}>
        {t}
      </button>
    ))}
  </div>
);

export const Pager = ({ pages }: { pages: number }) => (
  <div className="pager" aria-label="Pagination">
    <button aria-label="Previous page">‹</button>
    {Array.from({ length: pages }, (_, i) => (
      <button key={i} className={i === 0 ? "active" : ""} aria-current={i === 0 ? "page" : undefined}>{i + 1}</button>
    ))}
    <button aria-label="Next page">›</button>
  </div>
);

/** Placeholder approximation of the logo mark. Replace with the official asset when supplied. */
export const LogoMark = ({ size = 56 }: { size?: number }) => (
  <svg width={size} height={size * 0.62} viewBox="0 0 100 62" role="img" aria-label="Mue'ad logo mark">
    <defs>
      <linearGradient id="lgL" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#5b2c9a" /><stop offset="1" stopColor="#b04fc8" />
      </linearGradient>
      <linearGradient id="lgR" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" stopColor="#f0645a" /><stop offset="1" stopColor="#fda070" />
      </linearGradient>
    </defs>
    <rect x="4" y="14" width="62" height="30" rx="15" transform="rotate(-35 35 29)" fill="url(#lgL)" />
    <rect x="34" y="18" width="62" height="30" rx="15" transform="rotate(-35 65 33)" fill="url(#lgR)" opacity=".92" />
  </svg>
);
