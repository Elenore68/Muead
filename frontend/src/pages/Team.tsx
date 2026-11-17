import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Topbar } from "../components/Layout";
import { Person } from "../components/ui";
import { errorMessage } from "../api/client";
import { MIN_SEARCH, searchUsers, type DirectoryUser } from "../api/members";

type State = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; users: DirectoryUser[]; more: boolean };

/** TASK 13: the people directory. People appear after their first sign-in. No email addresses are shown. */
export default function Team() {
  const [q, setQ] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [onlyApprovers, setOnlyApprovers] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < MIN_SEARCH) {
      setState({ kind: "idle" });
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(() => {
      setState({ kind: "loading" });
      searchUsers({ q: term, approverEligible: onlyApprovers, limit: 50 }, ac.signal).then(
        (res) => !ac.signal.aborted && setState({ kind: "ready", users: res.items, more: !!res.nextToken }),
        (e) => {
          if (ac.signal.aborted || (e as Error).name === "AbortError") return;
          setState({ kind: "error", message: errorMessage(e) });
        },
      );
    }, 250);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [q, onlyApprovers]);

  return (
    <>
      <Topbar title="Team" subtitle="Find people on the platform." />
      <section className="card" aria-label="People directory">
        <div className="row3">
          <div className="field" style={{ gridColumn: "span 2" }}>
            <label htmlFor="team-q">Search by name</label>
            <div style={{ position: "relative" }}>
              <Search size={16} style={{ position: "absolute", insetInlineStart: 12, top: 12 }} aria-hidden="true" />
              <input id="team-q" className="input" style={{ paddingInlineStart: 36 }} value={q} placeholder={`At least ${MIN_SEARCH} letters`} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="team-approvers" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 26 }}>
              <input id="team-approvers" type="checkbox" checked={onlyApprovers} onChange={(e) => setOnlyApprovers(e.target.checked)} />
              Can approve requests
            </label>
          </div>
        </div>
        {state.kind === "idle" && <p className="placeholder">Type a name to search. Names start matching from the first letters.</p>}
        {state.kind === "loading" && <p className="placeholder" role="status">Searching…</p>}
        {state.kind === "error" && <div role="alert" className="notice error"><span>{state.message}</span></div>}
        {state.kind === "ready" && state.users.length === 0 && <p className="placeholder">No one matches. People appear here after their first sign-in.</p>}
        {state.kind === "ready" && state.users.length > 0 && (
          <ul className="member-list" aria-label="Results">
            {state.users.map((u) => (
              <li key={u.id}>
                <div className="member-main">
                  <Person name={u.displayName} initials={u.initials} />
                  {u.approvalEligible && <span className="pill chip">Can approve</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
        {state.kind === "ready" && state.more && <p className="cell-sub">More people match. Type more letters to narrow the list.</p>}
      </section>
    </>
  );
}
