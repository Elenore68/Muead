import { useState, type ReactNode } from "react";
import { NavLink, Outlet, useOutletContext } from "react-router-dom";
import { Bell, CalendarDays, CheckCircle2, ChevronDown, FileText, Home, Menu, Settings, BarChart3, Users } from "lucide-react";
import { Avatar, LogoMark } from "./ui";
import { team } from "../data/mock";
import { config } from "../config";
import { useAuth } from "../auth/AuthContext";

const nav = [
  { to: "/", label: "Dashboard", icon: Home, end: true },
  { to: "/requests", label: "Requests", icon: FileText },
  { to: "/schedule", label: "Schedule", icon: CalendarDays },
  { to: "/approvals", label: "Approvals", icon: CheckCircle2 },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/team", label: "Team", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function Layout() {
  const [open, setOpen] = useState(false);
  return (
    <div className={`shell ${open ? "open" : ""}`}>
      <aside className="sidebar" aria-label="Primary">
        <div className="logo">
          <LogoMark />
          <span className="logo-word">Mue'ad</span>
          <span className="logo-ar" lang="ar">ميعاد</span>
        </div>
        <nav className="nav">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)} title={label}>
              <Icon size={20} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="side-title">Team</div>
        <ul className="team">
          {team.map((t) => (
            <li key={t.name}>
              <Avatar name={t.name} />
              <span className="name">{t.name}</span>
              <span className="dot-online" title="Online" />
            </li>
          ))}
        </ul>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <main className="main">
        <Outlet context={{ openMenu: () => setOpen(true) }} />
      </main>
    </div>
  );
}

interface TopbarProps {
  title: string;
  subtitle?: string;
  crumbs?: string;
  action?: ReactNode;
}

export function Topbar({ title, subtitle, crumbs, action }: TopbarProps) {
  const ctx = useOutletContext<{ openMenu: () => void } | null>();
  const { profile, signOut } = useAuth();
  const live = config.apiEnabled && profile;
  return (
    <header className="topbar">
      <button className="btn-icon menu-btn" aria-label="Open menu" onClick={() => ctx?.openMenu()}><Menu size={20} /></button>
      <div style={{ flex: 1 }}>
        {crumbs && <div className="crumbs">{crumbs}</div>}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      <div className="top-actions">
        <button className="bell" aria-label="Notifications"><Bell size={22} /><i /></button>
        {live ? (
          // Real signed-in user from GET /me. Clicking signs out (no user menu is designed yet).
          <button className="user" aria-label={`Signed in as ${profile.displayName}. Sign out`} title="Sign out" onClick={signOut}>
            <Avatar name={profile.displayName} initials={profile.initials} large />{profile.displayName}<ChevronDown size={16} />
          </button>
        ) : (
          <button className="user" aria-label="User menu"><Avatar name="Amal" large />Amal<ChevronDown size={16} /></button>
        )}
        {action}
      </div>
    </header>
  );
}
