import type { ReactNode } from "react";
import { CalendarDays, Check, ChevronRight, FileText, Hourglass, RefreshCw, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { Topbar } from "../components/Layout";
import { config } from "../config";
import { useDashboard, type ChartPoint, type Section, type SummaryView } from "../data/useDashboard";

type Totals = SummaryView["totals"];

const statCards: { key: keyof Totals; label: string; icon: typeof FileText; tone: string }[] = [
  { key: "total", label: "Total Requests", icon: FileText, tone: "tone-violet" },
  { key: "pendingApprovals", label: "Pending Approvals", icon: Hourglass, tone: "tone-orange" },
  { key: "inProgress", label: "In Progress", icon: RefreshCw, tone: "tone-violet" },
  { key: "completed", label: "Completed", icon: Check, tone: "tone-green" },
];

/** Decision 1: only the three designed slices. */
const sliceDefs: { label: string; key: keyof Totals; color: string }[] = [
  { label: "Pending", key: "pendingApprovals", color: "#f9a24d" },
  { label: "In Progress", key: "inProgress", color: "#8e4fd0" },
  { label: "Completed", key: "completed", color: "#22b04b" },
];

type Slice = { label: string; n: number; color: string };

function Donut({ slices }: { slices: Slice[] }) {
  // Decision 1: the centre shows the sum of the three slices (not the overall total).
  const total = slices.reduce((a, s) => a + s.n, 0);
  const r = 60, c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width="170" height="170" viewBox="0 0 170 170" role="img" aria-label={`${total} requests by status`}>
      <g transform="rotate(-90 85 85)">
        {total === 0 ? (
          // Empty state: plain ring in the design's border colour instead of dividing by zero.
          <circle cx="85" cy="85" r={r} fill="none" stroke="#e6ddf3" strokeWidth="24" />
        ) : (
          slices.map((s) => {
            const len = (s.n / total) * c;
            const el = <circle key={s.label} cx="85" cy="85" r={r} fill="none" stroke={s.color} strokeWidth="24" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} />;
            offset += len;
            return el;
          })
        )}
      </g>
      <text x="85" y="85" textAnchor="middle" fontSize="30" fontWeight="800" fill="#2e1a5e">{total}</text>
      <text x="85" y="106" textAnchor="middle" fontSize="13" fill="#2b2350">Requests</text>
    </svg>
  );
}

function LineChart({ points }: { points: ChartPoint[] }) {
  const w = 600, h = 180, pad = 28;
  // At least 0-8 as designed; grows (in steps of 4, so ticks stay whole numbers) when real counts are higher.
  const max = Math.max(8, Math.ceil(Math.max(0, ...points.map((p) => p.value)) / 4) * 4);
  const ticks = [0, 1, 2, 3, 4].map((i) => (max * i) / 4);
  const step = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  const pts = points.map((p, i) => [pad + i * step, h - pad - (p.value / max) * (h - pad * 2)]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");
  const area = pts.length ? `${line} L${pts[pts.length - 1][0]},${h - pad} L${pts[0][0]},${h - pad} Z` : "";
  return (
    <svg viewBox={`0 0 ${w} ${h + 20}`} width="100%" role="img" aria-label="Requests over time">
      <defs>
        <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8e4fd0" stopOpacity=".3" /><stop offset="1" stopColor="#8e4fd0" stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t) => {
        const y = h - pad - (t / max) * (h - pad * 2);
        return <g key={t}><line x1={pad} x2={w - pad} y1={y} y2={y} stroke="#e6ddf3" /><text x={pad - 8} y={y + 4} textAnchor="end" fontSize="11" fill="#6b6585">{t}</text></g>;
      })}
      <path d={area} fill="url(#area)" />
      <path d={line} fill="none" stroke="#8e4fd0" strokeWidth="2" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p[0]} cy={p[1]} r="3.5" fill="#fff" stroke="#8e4fd0" strokeWidth="2" />
          {points[i].label !== null && <text x={p[0]} y={h + 10} textAnchor="middle" fontSize="11" fill="#6b6585">{points[i].label}</text>}
        </g>
      ))}
    </svg>
  );
}

/** Error notice with retry, in the existing .notice style. */
const Retry = ({ message, onRetry }: { message: string; onRetry: () => void }) => (
  <div role="alert" className="notice error">
    <span>{message}</span>
    <button className="btn btn-outline" onClick={onRetry}>Try again</button>
  </div>
);

const Loading = () => <p className="placeholder" role="status">Loading…</p>;

/** Body for cards fed by the summary call. The summary error itself is shown once, above the cards. */
function SummaryBody({ summary, children }: { summary: Section<SummaryView>; children: (d: SummaryView) => ReactNode }) {
  if (summary.state.kind === "loading") return <Loading />;
  if (summary.state.kind === "error") return <p className="placeholder">This data could not be loaded.</p>;
  return <>{children(summary.state.data)}</>;
}

export default function Dashboard() {
  const { firstName, summary, overTime, upcoming } = useDashboard();
  const totals = summary.state.kind === "ready" ? summary.state.data.totals : null;

  return (
    <>
      <Topbar title={firstName ? `Good morning, ${firstName} 👋` : "Good morning 👋"} subtitle="Here's what's happening in Mue'ad today." />
      {summary.state.kind === "error" && <Retry message={summary.state.message} onRetry={summary.retry} />}
      <section className="stats c4" aria-label="Summary" aria-busy={summary.state.kind === "loading" || undefined}>
        {statCards.map(({ key, label, icon: Icon, tone }) => (
          <div className="card stat" key={label}>
            <span className={`icon-tile ${tone}`}><Icon size={24} /></span>
            <div><div className="stat-num">{totals ? totals[key] : "—"}</div><div className="stat-label">{label}</div></div>
          </div>
        ))}
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2 className="card-title">Requests by Status</h2></div>
          <SummaryBody summary={summary}>
            {(d) => {
              const slices = sliceDefs.map((s) => ({ label: s.label, n: d.totals[s.key], color: s.color }));
              return (
                <div className="donut-wrap">
                  <Donut slices={slices} />
                  <ul className="legend">
                    {slices.map((s) => (
                      <li key={s.label}><span className="swatch" style={{ background: s.color }} />{s.label}<b>{s.n}</b></li>
                    ))}
                  </ul>
                </div>
              );
            }}
          </SummaryBody>
        </section>
        <section className="card">
          <div className="card-head">
            <h2 className="card-title"><CalendarDays size={20} />Upcoming Schedule</h2>
            <Link to="/schedule" className="link">View All →</Link>
          </div>
          {upcoming.state.kind === "loading" && <Loading />}
          {upcoming.state.kind === "error" && <Retry message={upcoming.state.message} onRetry={upcoming.retry} />}
          {upcoming.state.kind === "ready" && upcoming.state.data.length === 0 && <p className="placeholder">No upcoming activities.</p>}
          {upcoming.state.kind === "ready" && upcoming.state.data.length > 0 && (
            // Decision 5: items stay non-clickable.
            <ul className="sched">
              {upcoming.state.data.map((s) => (
                <li key={s.key}>
                  <span className="bar" style={{ background: s.color }} />
                  <div className="grow"><b>{s.title}</b><small>{s.when}</small></div>
                  <ChevronRight size={18} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2 className="card-title">Requests Over Time</h2></div>
          {overTime.state.kind === "loading" && <Loading />}
          {overTime.state.kind === "error" && <Retry message={overTime.state.message} onRetry={overTime.retry} />}
          {overTime.state.kind === "ready" && <LineChart points={overTime.state.data} />}
        </section>
        <section className="card">
          <div className="card-head"><h2 className="card-title">Requests by Category</h2></div>
          <SummaryBody summary={summary}>
            {(d) => {
              if (d.categories.length === 0) return <p className="placeholder">No requests yet.</p>;
              // Bar widths are relative to the largest category (the mock's largest is 4, as before).
              const maxN = Math.max(1, ...d.categories.map((c) => c.n));
              return (
                <div className="bars">
                  <ul>
                    {d.categories.map((c) => (
                      <li key={c.name}>
                        <span>{c.name}</span>
                        <span className="track"><span className="fill" style={{ display: "block", width: `${(c.n / maxN) * 100}%`, background: c.color }} /></span>
                        <b>{c.n}</b>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            }}
          </SummaryBody>
          <div style={{ marginTop: 16 }}>
            {/* Decision 6: visible but disabled in live mode; the AI summary endpoint is not built yet. */}
            <button className="btn btn-primary" disabled={config.apiEnabled} aria-describedby={config.apiEnabled ? "ai-summary-note" : undefined}>
              <Sparkles size={16} />Generate Summary
            </button>
            {config.apiEnabled && <small id="ai-summary-note" className="cell-sub" style={{ display: "block", marginTop: 8 }}>AI summary is not available yet.</small>}
          </div>
        </section>
      </div>
    </>
  );
}
