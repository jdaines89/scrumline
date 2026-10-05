"use client";

import { useEffect, useState } from "react";
import { useLeague } from "@/components/league";
import { supabase } from "@/lib/supabase";

interface Target { day: number; date: string; wac: number; live_leagues: number }
interface Gates {
  as_of: string; players: number; wac: number; leagues: number; live_leagues: number; alerts: number | null;
  wac_weeks: { week: string; callers: number }[];
  funnel: { joined: number; team: number; first_call: number; two_weeks: number };
  targets: Target[];
}

const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");

function Progress({ label, value, target }: { label: string; value: number; target: number }) {
  const share = Math.min(1, target ? value / target : 0);
  return (
    <div className="gate-row">
      <div className="gate-label"><span>{label}</span><span className="num"><strong>{value}</strong> <span className="muted">of {target}</span></span></div>
      <div className="gate-bar"><span style={{ width: `${share * 100}%` }} /></div>
    </div>
  );
}

/** The 90-day targets from the plan, measured straight from the event log. Admins only. */
export default function AdminMetrics() {
  const { me } = useLeague();
  const [g, setG] = useState<Gates | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!me.is_admin) return;
    supabase.rpc("gate_metrics").then(({ data, error }) => {
      if (error || !data?.targets) setErr(error?.message ?? "No numbers yet."); else setG(data as Gates);
    });
  }, [me.is_admin]);

  if (!me.is_admin) return <div className="card narrow"><h2>Admins only</h2></div>;
  if (err) return <div className="card narrow"><h2>Growth targets</h2><p className="small muted">{err}</p></div>;
  if (!g) return <div className="card narrow"><div className="skeleton" style={{ height: 160 }} /></div>;

  const today = new Date().toISOString().slice(0, 10);
  const next = g.targets.find((t) => t.date >= today) ?? g.targets[g.targets.length - 1];
  const peak = Math.max(1, ...g.wac_weeks.map((w) => w.callers));
  const f = g.funnel;

  return (
    <>
      <div className="card narrow">
        <p className="sp-kicker">Admin</p>
        <h2>Growth targets</h2>
        <p className="sub">Next: day {next.day}, {day(next.date)}. Counted Monday to Sunday, South African time.</p>
        <Progress label="Weekly active callers" value={g.wac} target={next.wac} />
        <Progress label="Leagues with 4+ calling this week" value={g.live_leagues} target={next.live_leagues} />
        <p className="small muted" style={{ marginBottom: 0 }}>
          {g.players} players · {g.leagues} {g.leagues === 1 ? "league" : "leagues"} with 4+ members · {g.alerts === null ? "–" : `${Math.round(g.alerts * 100)}%`} get phone alerts
        </p>
      </div>

      <div className="card narrow">
        <h3 className="numbers-h" style={{ marginTop: 0 }}>Weekly active callers, last 12 weeks</h3>
        <div className="gate-spark" role="img" aria-label="Weekly active callers by week">
          {g.wac_weeks.map((w) => (
            <div key={w.week} title={`Week of ${day(w.week)}: ${w.callers}`}>
              <span style={{ height: `${(w.callers / peak) * 100}%` }} />
            </div>
          ))}
        </div>
        <div className="gate-spark-axis small muted"><span>{day(g.wac_weeks[0].week)}</span><span>This week</span></div>
      </div>

      <div className="card narrow">
        <h3 className="numbers-h" style={{ marginTop: 0 }}>New players, last 60 days</h3>
        <table>
          <tbody>
            <tr><td>Joined</td><td className="num">{f.joined}</td><td className="num muted" /></tr>
            <tr><td>Made a team</td><td className="num">{f.team}</td><td className="num muted">{pct(f.team, f.joined)}</td></tr>
            <tr><td>Made a first call</td><td className="num">{f.first_call}</td><td className="num muted">{pct(f.first_call, f.joined)}</td></tr>
            <tr><td>Called in 2+ weeks</td><td className="num">{f.two_weeks}</td><td className="num muted">{pct(f.two_weeks, f.joined)}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="card narrow">
        <h3 className="numbers-h" style={{ marginTop: 0 }}>All targets</h3>
        <table>
          <thead><tr><th>Target</th><th>Date</th><th className="num">Callers</th><th className="num">Leagues</th></tr></thead>
          <tbody>
            {g.targets.map((t) => (
              <tr key={t.day}><td>Day {t.day}</td><td>{day(t.date)}</td><td className="num">{t.wac}</td><td className="num">{t.live_leagues}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
