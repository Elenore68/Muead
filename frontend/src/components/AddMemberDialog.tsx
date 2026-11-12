import { useEffect, useState, type FormEvent } from "react";
import { errorMessage } from "../api/client";
import { addMember, MIN_SEARCH, searchUsers, SPECIALTIES, type AssignableRole, type DirectoryUser, type Member } from "../api/members";
import { specialtyLabel } from "../api/labels";
import { assignableUsers } from "../data/permissions";
import Modal from "./Modal";
import { Avatar } from "./ui";

interface AddMemberDialogProps {
  requestId: string;
  role: AssignableRole;
  /** Current members (any status), to hide people who already hold a role in this request. */
  members: Member[];
  callerId: string | undefined;
  onAdded: (m: Member) => void;
  onClose: () => void;
}

type Search = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; users: DirectoryUser[]; hidden: number };

/**
 * Directory search (GET /users) + assignment (POST /requests/{id}/members).
 * - Approvers: only ApprovalEligible users are searched; the caller is never offered (self-assignment is forbidden).
 * - Anyone who already has an ACTIVE role in this request is hidden (one role per person per request).
 * - No email addresses are shown; the API does not return them.
 */
export default function AddMemberDialog({ requestId, role, members, callerId, onAdded, onClose }: AddMemberDialogProps) {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState<Search>({ kind: "idle" });
  const [selected, setSelected] = useState<DirectoryUser | null>(null);
  const [specialty, setSpecialty] = useState("");
  const [responsibilities, setResponsibilities] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isApprover = role === "APPROVER";
  const noun = isApprover ? "approver" : "participant";

  useEffect(() => {
    const term = q.trim();
    if (term.length < MIN_SEARCH) {
      setSearch({ kind: "idle" });
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(() => {
      setSearch({ kind: "loading" });
      searchUsers({ q: term, approverEligible: isApprover, limit: 20 }, ac.signal).then(
        (res) => {
          if (ac.signal.aborted) return;
          const users = assignableUsers(res.items, members, role, callerId);
          setSearch({ kind: "ready", users, hidden: res.items.length - users.length });
        },
        (e) => {
          if (ac.signal.aborted || (e as Error).name === "AbortError") return;
          setSearch({ kind: "error", message: errorMessage(e) });
        },
      );
    }, 300);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [q, isApprover, members, role, callerId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected) return setError(`Choose a person to add as ${noun}.`);
    if (responsibilities.trim().length > 1000) return setError("Responsibilities are too long (max 1000 characters).");
    setBusy(true);
    setError("");
    try {
      const m = await addMember(requestId, {
        userId: selected.id,
        activityRole: role,
        ...(!isApprover && specialty ? { specialty } : {}),
        ...(!isApprover && responsibilities.trim() ? { responsibilities: responsibilities.trim() } : {}),
      });
      onAdded(m);
    } catch (ex) {
      // Backend messages are already specific (ROLE_CONFLICT, NOT_ELIGIBLE, APPROVER_LIMIT, LOCKED_WHILE_PENDING, ...).
      setError(errorMessage(ex));
      setBusy(false);
    }
  };

  return (
    <Modal title={isApprover ? "Add approver" : "Add participant"} onClose={onClose} busy={busy}>
      <form onSubmit={submit} noValidate aria-busy={busy}>
        <p className="page-sub" style={{ marginBottom: 12 }}>
          {isApprover
            ? "Only people in the ApprovalEligible group can be assigned. Owners and participants of this request cannot approve it."
            : "Participants work on this activity. They cannot approve it."}
        </p>
        <div className="field">
          <label htmlFor="member-search">Search by name</label>
          <input id="member-search" className="input" value={q} onChange={(e) => { setQ(e.target.value); setSelected(null); }}
            placeholder={`Type at least ${MIN_SEARCH} characters`} autoComplete="off" disabled={busy} aria-describedby="member-search-status" />
        </div>
        <div id="member-search-status" aria-live="polite">
          {search.kind === "idle" && <p className="cell-sub">Type at least {MIN_SEARCH} characters to search the directory.</p>}
          {search.kind === "loading" && <p className="cell-sub" role="status">Searching…</p>}
          {search.kind === "error" && <p role="alert" className="notice error">{search.message}</p>}
          {search.kind === "ready" && search.users.length === 0 && (
            <p className="cell-sub">No one available{search.hidden ? ` (${search.hidden} already in this request)` : ""}. People appear after their first sign-in.</p>
          )}
        </div>
        {search.kind === "ready" && search.users.length > 0 && (
          <ul className="result-list" role="listbox" aria-label="Search results">
            {search.users.map((u) => (
              <li key={u.id} role="option" aria-selected={selected?.id === u.id}>
                <button type="button" className={`result ${selected?.id === u.id ? "selected" : ""}`} onClick={() => setSelected(u)} disabled={busy}>
                  <Avatar name={u.displayName} initials={u.initials} />
                  <span>{u.displayName}</span>
                  {u.approvalEligible && <span className="pill chip">Eligible approver</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {!isApprover && (
          <>
            <div className="field">
              <label htmlFor="member-specialty">Specialty <span className="cell-sub">(optional)</span></label>
              <select id="member-specialty" className="select" value={specialty} onChange={(e) => setSpecialty(e.target.value)} disabled={busy}>
                <option value="">No specialty</option>
                {SPECIALTIES.map((s) => <option key={s} value={s}>{specialtyLabel(s)}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="member-resp">Responsibilities <span className="cell-sub">(optional)</span></label>
              <textarea id="member-resp" className="textarea" value={responsibilities} onChange={(e) => setResponsibilities(e.target.value)} maxLength={1000} disabled={busy} />
            </div>
          </>
        )}
        {error && <p role="alert" className="notice error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !selected}>{busy ? "Adding…" : selected ? `Add ${selected.displayName}` : `Add ${noun}`}</button>
        </div>
      </form>
    </Modal>
  );
}
