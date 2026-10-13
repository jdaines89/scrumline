"use client";

import { useEffect, useState } from "react";
import { useLeague } from "@/components/league";
import { kickoff, roundName } from "@/lib/format";
import { worthSwitching, type NextUp } from "@/lib/seasons";
import type { Season } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { startsIn } from "@/components/season-ahead";

const SOON_KEY = "sl:soon-hidden:";

/**
 * When the tournament you're looking at is resting and another one is on
 * (the URC break and the November tests), one quiet line pointing at it.
 */
export function AlsoOn() {
  const { seasons, season, matches, setSeason, competitions } = useLeague();
  // The next round elsewhere; two cups kicking off together both get a line.
  const [nexts, setNexts] = useState<NextUp[]>([]);
  // "Starts soon" lines you've closed stay closed, one tournament at a time.
  const [closed, setClosed] = useState<string[]>([]);
  const isClosed = (id: string) => {
    if (closed.includes(id)) return true;
    try { return !!localStorage.getItem(SOON_KEY + id); } catch { return false; }
  };
  const close = (id: string) => {
    setClosed((c) => [...c, id]);
    try { localStorage.setItem(SOON_KEY + id, "1"); } catch { /* storage blocked: hidden until the page reloads */ }
  };
  const others = seasons.filter((s) => !s.is_replay && s.id !== season.id).map((s) => s.id).join(",");
  useEffect(() => {
    setNexts([]);
    if (!others) return;
    supabase.from("matches").select("season, round, kickoff_at").in("season", others.split(","))
      .gt("kickoff_at", new Date().toISOString()).order("kickoff_at").limit(30)
      .then(({ data }) => {
        const rows = (data ?? []) as NextUp[];
        const first = rows[0] ? Date.parse(rows[0].kickoff_at) : 0;
        // Each tournament's first match, kept only where it starts at the same time as the earliest.
        setNexts(rows.filter((r, i) => Date.parse(r.kickoff_at) === first && rows.findIndex((x) => x.season === r.season) === i));
      });
  }, [others]);

  const now = Date.now();
  const mine = matches.find((m) => new Date(m.kickoff_at).getTime() > now)?.kickoff_at ?? null;
  const shown = worthSwitching(mine, nexts[0] ?? null, now)
    ? nexts.flatMap((n) => seasons.filter((s) => s.id === n.season).map((s) => ({ season: s, next: n })))
    : [];
  // Tournaments starting within two weeks get a line from their start date, so a cup shows the day it's loaded
  // rather than only once it kicks off before the next game here. Worked out from the seasons, so it never pops in.
  const today = new Date(now).toISOString().slice(0, 10);
  const fortnight = new Date(now + 14 * 864e5).toISOString().slice(0, 10);
  const soon = seasons.filter((s) => !s.is_replay && s.id !== season.id && !shown.some((x) => x.season.id === s.id)
    && s.starts_on && s.starts_on > today && s.starts_on <= fortnight && !isClosed(s.id));
  const soonCard = soon.length > 0 && (
    <div className="card also-soon">
      {soon.map((s) => (
        <div className="also-row" key={s.id}>
          <p><strong>{s.name}</strong> starts {new Date(`${s.starts_on}T12:00:00Z`).toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg", weekday: "short", day: "numeric", month: "long" })}. Your leagues are in it already.</p>
          <div className="also-acts">
            <button type="button" className="ghost" onClick={() => close(s.id)}>Not now</button>
            <button type="button" onClick={() => setSeason(s.id)}>Open</button>
          </div>
        </div>
      ))}
    </div>
  );
  if (!shown.length) return soonCard || null;
  // "the URC", but "the Nations Championship" rather than "the Nations".
  const comp = competitions.get(season.competition_id);
  const here = comp ? (/^[A-Z]+$/.test(comp.short_name) ? comp.short_name : comp.name) : season.name;
  // Only a tournament that has already kicked off can be resting; one still to come simply starts later.
  const started = matches.some((m) => new Date(m.kickoff_at).getTime() <= now);
  const line = (target: Season, other: NextUp) => started
    ? <><strong>{target.name}</strong> is on while the {here} rests. {roundName(other.round)} starts {kickoff(other.kickoff_at)}.</>
    : <><strong>{target.name}</strong> is on now, with {roundName(other.round).toLowerCase()} starting {kickoff(other.kickoff_at)}. The {here} starts {mine ? kickoff(mine) : startsIn(season.starts_on) ? `in ${startsIn(season.starts_on)}` : "later"}.</>;
  return (<>
    {shown.length === 1 ? (
      <div className="card also-on">
        <p>{line(shown[0].season, shown[0].next)}</p>
        <button type="button" onClick={() => setSeason(shown[0].season.id)}>Play it</button>
      </div>
    ) : (
      <div className="card also-soon">
        {shown.map(({ season: t, next }) => (
          <div className="also-row" key={t.id}>
            <p>{line(t, next)}</p>
            <div className="also-acts"><button type="button" onClick={() => setSeason(t.id)}>Play it</button></div>
          </div>
        ))}
      </div>
    )}
    {soonCard}
  </>);
}
