import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Filter, MoreVertical, Plus, Search } from "lucide-react";
import { Topbar } from "../components/Layout";
import { CategoryChip, Person, PriorityPill, StatusPill } from "../components/ui";
import { PAGE_SIZE, TABS, useRequestList, type Tab } from "../data/useRequestList";

interface Flash {
  created?: string;
  warning?: string;
}

export default function Requests() {
  const [tab, setTab] = useState<Tab>("All");
  const [q, setQ] = useState("");
  const list = useRequestList(tab, q);
  const { rows, loading, error, tabCounts, page, hasNext, total } = list;

  // One-time success / warning message passed from the Create Request form.
  const loc = useLocation();
  const nav = useNavigate();
  const [flash, setFlash] = useState<Flash | null>(null);
  useEffect(() => {
    const s = loc.state as Flash | null;
    if (s?.created) {
      setFlash(s);
      nav(loc.pathname, { replace: true, state: null }); // do not show it again on refresh
    }
  }, [loc, nav]);

  const label = (t: Tab) => (tabCounts?.[t] !== undefined ? `${t} (${tabCounts[t]})` : t);
  const from = rows.length ? page * PAGE_SIZE + 1 : 0;
  const to = page * PAGE_SIZE + rows.length;

  return (
    <>
      <Topbar
        title="Maintenance Requests"
        subtitle="View, track, and manage all maintenance requests."
        action={<Link to="/requests/new" className="btn btn-primary"><Plus size={18} />New Request</Link>}
      />
      {flash?.created && (
        <div role="status" className="notice success">
          <span>Request {flash.created} was created as a draft.</span>
          <button className="btn btn-outline" onClick={() => setFlash(null)}>Dismiss</button>
        </div>
      )}
      {flash?.warning && (
        <div role="alert" className="notice warning"><span>{flash.warning}</span></div>
      )}
      {error && (
        <div role="alert" className="notice error">
          <span>{error}</span>
          <button className="btn btn-outline" onClick={list.reload}>Try again</button>
        </div>
      )}
      <div className="toolbar">
        <div role="tablist" className="tabs">
          {TABS.map((t) => (
            <button key={t} role="tab" aria-selected={t === tab} className={`tab ${t === tab ? "active" : ""}`} onClick={() => setTab(t)}>{label(t)}</button>
          ))}
        </div>
        <div className="toolbar-r">
          <label className="search"><Search size={18} /><span className="sr-only">Search requests</span>
            <input placeholder="Search requests..." value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <button className="btn-icon" aria-label="Filter"><Filter size={18} /></button>
        </div>
      </div>
      <div className="card table-wrap" aria-busy={loading}>
        <table className="stack">
          <thead>
            <tr><th>Request ID</th><th>Title</th><th>Category</th><th>Requested by</th><th>Assigned to</th><th>Priority</th><th>Status</th><th>Created</th><th><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.displayId}</td>
                <td><Link to={`/requests/${r.linkId}`} className="cell-title"><span className="icon-tile"><Search size={16} /></span>{r.title}</Link></td>
                <td data-label="Category"><CategoryChip>{r.category}</CategoryChip></td>
                <td data-label="Requested by"><Person name={r.requestedBy} initials={r.requestedByInitials} /></td>
                <td data-label="Assigned to">{r.assignedTo ? <Person name={r.assignedTo} /> : <span aria-label="Not assigned">—</span>}</td>
                <td><PriorityPill priority={r.priority} /></td>
                <td><StatusPill status={r.status} /></td>
                <td data-label="Created">{r.created}</td>
                <td><button className="btn-icon" style={{ width: 28, height: 28, border: 0, background: "none" }} aria-label="Row actions"><MoreVertical size={18} /></button></td>
              </tr>
            ))}
            {loading && rows.length === 0 && (
              <tr><td colSpan={9} className="placeholder" role="status">Loading requests…</td></tr>
            )}
            {!loading && !error && rows.length === 0 && (
              <tr><td colSpan={9} className="placeholder">{q.trim() ? "No requests match your search." : "No requests found."}</td></tr>
            )}
          </tbody>
        </table>
        <div className="table-foot">
          <span>
            {loading && rows.length === 0
              ? "Loading…"
              : total !== null
                ? `Showing ${from}-${to} of ${total} requests`
                : `Showing ${from}-${to} requests`}
          </span>
          <div className="pager" aria-label="Pagination">
            <button aria-label="Previous page" onClick={list.prev} disabled={page === 0 || loading}>‹</button>
            <button className="active" aria-current="page">{page + 1}</button>
            <button aria-label="Next page" onClick={list.next} disabled={!hasNext || loading}>›</button>
          </div>
        </div>
      </div>
    </>
  );
}
