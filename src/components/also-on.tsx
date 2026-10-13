"use client";

import { useEffect, useState } from "react";
import { useLeague } from "@/components/league";
import { kickoff, roundName } from "@/lib/format";
import { seasonLine, worthSwitching, type NextUp } from "@/lib/seasons";
import type { Season } from "@/lib/types";
import { TournamentLogo } from "@/components/tournament-logo";
import { supabase } from "@/lib/supabase";
import { startsIn } from "@/components/season-ahead";

/**
 * When the tournament you're looking at is resting and another one is on
 * (the URC break and the November tests), one quiet line pointing at it.
 */
export function AlsoOn() {
  const { seasons, season, matches, setSeason, competitions } = useLeague();
  // The next round elsewhere; two cups kicking off together both get a line.
  const [nexts, setNexts] = useState<NextUp[]>([]);
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
  // Every other tournament still to come or being played, always listed (nothing to dismiss), so none goes unseen.
  const today = new Date(now).toISOString().slice(0, 10);
  const more = seasons.filter((s) => !s.is_replay && s.id !== season.id && !shown.some((x) => x.season.id === s.id)
    && (!s.ends_on || s.ends_on >= today))
    .sort((a, b) => (a.starts_on ?? "").localeCompare(b.starts_on ?? ""));
  const moreCard = more.length > 0 && (
    <div className="card also-more">
      <h3>Also on Scrumline</h3>
      {more.map((s) => (
        <button type="button" className="also-more-row" key={s.id} onClick={() => setSeason(s.id)}>
          <TournamentLogo competition={competitions.get(s.competition_id)} size={32} />
          <span className="also-more-text">
            <strong>{s.name}</strong>
            <span>{seasonLine(s)}</span>
          </span>
          <span className="also-more-go" aria-hidden="true">Open</span>
        </button>
      ))}
    </div>
  );
  if (!shown.length) return moreCard || null;
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
    {moreCard}
  </>);
}
