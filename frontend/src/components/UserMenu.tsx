import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, LogOut, Settings } from "lucide-react";
import { Avatar } from "./ui";

interface Props {
  name: string;
  initials?: string;
  email: string;
  roles: string[];
  onSignOut: () => void;
}

const roleText = (roles: string[]) =>
  roles.includes("PlatformAdmin") ? "Administrator" : roles.includes("ApprovalEligible") ? "Manager (approves requests)" : "Maintenance";

/** The signed-in person's menu: who you are, Settings, and Sign out. Opening it never signs you out. */
export default function UserMenu({ name, initials, email, roles, onSignOut }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="user-menu" ref={ref}>
      <button type="button" className="user" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Avatar name={name} initials={initials} large />{name}<ChevronDown size={16} />
      </button>
      {open && (
        <div className="card notif-panel user-panel" role="menu" aria-label="Account">
          <div className="user-panel-head">
            <strong>{name}</strong>
            <small className="cell-sub">{email}</small>
            <small className="cell-sub">{roleText(roles)}</small>
          </div>
          <Link to="/settings" role="menuitem" className="user-panel-item" onClick={() => setOpen(false)}><Settings size={16} />Settings</Link>
          <button type="button" role="menuitem" className="user-panel-item" onClick={() => { setOpen(false); onSignOut(); }}><LogOut size={16} />Sign out</button>
        </div>
      )}
    </div>
  );
}
