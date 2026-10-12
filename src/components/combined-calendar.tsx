"use client";

import { useEffect, useMemo, useState } from "react";
import { FixtureCard, fixtureDay } from "@/components/fixture-card";
import { useLeague } from "@/components/league";
import { readCache, writeCache } from "@/lib/cache";
import { roundName } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { Match } from "@/lib/types";

const SAST = "Africa/Johannesburg";
const dayKey = (iso: string | Date) => new Date(iso).toLocaleDateString("en-CA", { timeZone: SAST });
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// One colour per tournament, so a day's dots say which tournaments play on it.
const HUES = ["#d9b75a", "#35c98a", "#5aa9e6", "#e07a5f", "#b58ae6", "#e6c05a"];
const pad = (n: number) => String(n).padStart(2, "0");

/** Every tournament by month: tap a day to see what is on and when. */
export function CombinedCalendar() {
  const { seasons, competitions, teams } = useLeague();
  const today = dayKey(new Date());
  const [ym, setYm] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) }));
  const [picked, setPicked] = useState<string | null>(null);
  const ids = useMemo(() => seasons.filter((s) => !s.is_replay).map((s) => s.id), [seasons]);
  const monthStart = `${ym.y}-${pad(ym.m)}-01`;
  const key = `calendar2:${ids.join(",")}:${monthStart}`;
  const [matches, setMatches] = useState<Match[] | null>(() => readCache<Match[]>(key) ?? null);

  useEffect(() => {
    setMatches(readCache<Match[]>(key) ?? null);
    if (!ids.length) { setMatches([]); return; }
    const next = ym.m === 12 ? `${ym.y + 1}-01-01` : `${ym.y}-${pad(ym.m + 1)}-01`;
    supabase.from("matches").select("*").in("season", ids)
      .gte("kickoff_at", `${monthStart}T00:00:00+02:00`).lt("kickoff_at", `${next}T00:00:00+02:00`).order("kickoff_at").limit(500)
      .then(({ data, error }) => { if (error) return; const m = (data ?? []) as Match[]; writeCache(key, m); setMatches(m); });
  }, [key]);

  const seasonOf = useMemo(() => new Map(seasons.map((s) => [s.id, s])), [seasons]);
  const compOf = (m: Match) => seasonOf.get(m.season)?.competition_id ?? "";
  const hue = (c: string) => HUES[[...new Set(seasons.map((s) => s.competition_id))].sort().indexOf(c) % HUES.length];

  const byDay = useMemo(() => {
    const d = new Map<string, Match[]>();
    for (const m of matches ?? []) { const k = dayKey(m.kickoff_at); d.set(k, [...(d.get(k) ?? []), m]); }
    return d;
  }, [matches]);

  // Opens on today, else the next day with matches this month.
  const first = [...byDay.keys()].sort();
  const open = picked && picked.startsWith(monthStart.slice(0, 7)) ? picked
    : byDay.has(today) && today.startsWith(monthStart.slice(0, 7)) ? today
    : first.find((k) => k >= today) ?? first[0] ?? null;

  const lead = (new Date(Date.UTC(ym.y, ym.m - 1, 1)).getUTCDay() + 6) % 7; // Monday first
  const length = new Date(Date.UTC(ym.y, ym.m, 0)).getUTCDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length }, (_, i) => i + 1)];
  const step = (by: number) => { const d = new Date(Date.UTC(ym.y, ym.m - 1 + by, 1)); setYm({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 }); setPicked(null); };
  const title = new Date(Date.UTC(ym.y, ym.m - 1, 1)).toLocaleDateString("en-ZA", { timeZone: "UTC", month: "long", year: "numeric" });
  const shown = open ? byDay.get(open) ?? [] : [];
  const tournaments = [...new Set((matches ?? []).map(compOf))];

  return (
    <>
      <div className="card cal">
        <div className="cal-head">
          <button type="button" className="ghost arrow" aria-label="Previous month" onClick={() => step(-1)}>‹</button>
          <h2>{title}</h2>
          <button type="button" className="ghost arrow" aria-label="Next month" onClick={() => step(1)}>›</button>
        </div>
        <div className="cal-grid" role="grid" aria-label={title}>
          {WEEK.map((w) => <span key={w} className="cal-dow">{w}</span>)}
          {cells.map((n, i) => {
            if (n === null) return <span key={`b${i}`} />;
            const k = `${monthStart.slice(0, 8)}${pad(n)}`;
            const ms = byDay.get(k) ?? [];
            const comps = [...new Set(ms.map(compOf))];
            return (
              <button key={k} type="button" role="gridcell" aria-selected={open === k} disabled={!ms.length}
                className={`cal-day${ms.length ? " has" : ""}${k === today ? " today" : ""}${open === k ? " on" : ""}`}
                aria-label={`${n} ${title}: ${ms.length} ${ms.length === 1 ? "match" : "matches"}`} onClick={() => setPicked(k)}>
                <span className="cal-n">{n}</span>
                <span className="cal-dots" aria-hidden="true">{comps.slice(0, 3).map((c) => <i key={c} style={{ background: hue(c) }} />)}</span>
              </button>
            );
          })}
        </div>
        {tournaments.length > 1 && (
          <p className="cal-key small">{tournaments.map((c) => <span key={c}><i style={{ background: hue(c) }} />{competitions.get(c)?.short_name ?? c}</span>)}</p>
        )}
      </div>
      {matches === null ? <div className="card"><div className="match skeleton" style={{ height: 150 }} /></div>
        : !matches.length ? <p className="muted">No matches in {title}.</p>
        : open && <div className="card">
          <h2>{fixtureDay(shown[0].kickoff_at)}</h2>
          <p className="sub">{shown.length} {shown.length === 1 ? "match" : "matches"}. Kick-off times are South African time.</p>
          {shown.map((m) => <FixtureCard key={m.id} m={m} teams={teams} competition={competitions.get(compOf(m))} round={roundName(m.round)} />)}
        </div>}
    </>
  );
}
