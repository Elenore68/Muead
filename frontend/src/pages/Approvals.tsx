import { useState } from "react";
import { Check, CheckCircle2, Filter, Hourglass, Search, X, XCircle } from "lucide-react";
import { Topbar } from "../components/Layout";
import { CategoryChip, Pager, Person, PriorityPill, Tabs } from "../components/ui";
import { approvals } from "../data/mock";

const stats = [
  { n: 4, label: "Pending Approvals", icon: Hourglass, tone: "tone-orange" },
  { n: 8, label: "Approved", icon: CheckCircle2, tone: "tone-green" },
  { n: 2, label: "Rejected", icon: XCircle, tone: "tone-red" },
];

export default function Approvals() {
  const [tab, setTab] = useState("Pending (4)");
  const [items, setItems] = useState(approvals);
  const decide = (id: string) => setItems((xs) => xs.filter((x) => x.id !== id)); // mock only

  return (
    <>
      <Topbar title="Approvals" subtitle="Review and take action on maintenance requests." />
      <section className="stats c3" aria-label="Approval summary">
        {stats.map(({ n, label, icon: Icon, tone }) => (
          <div className="card stat" key={label}>
            <span className={`icon-tile ${tone}`}><Icon size={24} /></span>
            <div><div className="stat-num">{n}</div><div className="stat-label">{label}</div></div>
          </div>
        ))}
      </section>
      <div className="toolbar">
        <Tabs items={["Pending (4)", "Approved (8)", "Rejected (2)"]} active={tab} onChange={setTab} />
        <div className="toolbar-r">
          <label className="search"><Search size={18} /><span className="sr-only">Search requests</span><input placeholder="Search requests..." /></label>
          <button className="btn-icon" aria-label="Filter"><Filter size={18} /></button>
        </div>
      </div>
      <div className="card table-wrap">
        <table className="stack">
          <thead>
            <tr><th><input type="checkbox" aria-label="Select all" /></th><th>Request ID</th><th>Title</th><th>Requested by</th><th>Category</th><th>Priority</th><th>Requested on</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {tab.startsWith("Pending") ? items.map((a) => (
              <tr key={a.id}>
                <td><input type="checkbox" aria-label={`Select ${a.id}`} /></td>
                <td>{a.id}</td>
                <td><div style={{ fontWeight: 700 }}>{a.title}</div><div className="cell-sub">{a.description}</div></td>
                <td data-label="Requested by"><Person name={a.requestedBy} /></td>
                <td data-label="Category"><CategoryChip>{a.category}</CategoryChip></td>
                <td><PriorityPill priority={a.priority} /></td>
                <td data-label="Requested on">{a.requestedOn}</td>
                <td>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-approve" onClick={() => decide(a.id)}><Check size={16} />Approve</button>
                    <button className="btn btn-reject" onClick={() => decide(a.id)}><X size={16} />Reject</button>
                  </div>
                </td>
              </tr>
            )) : <tr><td colSpan={8} className="placeholder">Nothing to show in this tab yet.</td></tr>}
            {tab.startsWith("Pending") && items.length === 0 && <tr><td colSpan={8} className="placeholder">All caught up.</td></tr>}
          </tbody>
        </table>
        <div className="table-foot"><span>Showing {items.length ? 1 : 0}-{items.length} of {items.length} requests</span><Pager pages={1} /></div>
      </div>
    </>
  );
}
