"use client";

import { useEffect, useState } from "react";
import { useLeague } from "@/components/league";
import { kickoff, roundName } from "@/lib/format";
import { worthSwitching, type NextUp } from "@/lib/seasons";
import { supabase } from "@/lib/supabase";
import { startsIn } from "@/components/season-ahead";

/**
 * When the tournament you're looking at is resting and another one is on
 * (the URC break and the November tests), one quiet line pointing at it.
 */
export function AlsoOn() {
  const { seasons, season, matches, setSeason, competitions } = useLeague();
  const [other, setOther] = useState<NextUp | null>(null);
  const others = seasons.filter((s) => !s.is_replay && s.id !== season.id).map((s) => s.id).join(",");
  useEffect(() => {
    setOther(null);
    if (!others) return;
    supabase.from("matches").select("season, round, kickoff_at").in("season", others.split(","))
      .gt("kickoff_at", new Date().toISOString()).order("kickoff_at").limit(1)
      .then(({ data }) => setOther(((data ?? []) as NextUp[])[0] ?? null));
  }, [others]);

  const now = Date.now();
  const mine = matches.find((m) => new Date(m.kickoff_at).getTime() > now)?.kickoff_at ?? null;
  const shown = worthSwitching(mine, other, now) ? seasons.find((s) => s.id === other!.season) ?? null : null;
  // Tournaments starting within two weeks get a line from their start date, so a cup shows the day it's loaded
  // rather than only once it kicks off before the next game here. Worked out from the seasons, so it never pops in.
  const today = new Date(now).toISOString().slice(0, 10);
  const fortnight = new Date(now + 14 * 864e5).toISOString().slice(0, 10);
  const soon = seasons.filter((s) => !s.is_replay && s.id !== season.id && s.id !== shown?.id
    && s.starts_on && s.starts_on > today && s.starts_on <= fortnight);
  const soonCard = soon.length > 0 && (
    <div className="card also-soon">
      {soon.map((s) => (
        <div className="also-row" key={s.id}>
          <p><strong>{s.name}</strong> starts {new Date(`${s.starts_on}T12:00:00Z`).toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg", weekday: "short", day: "numeric", month: "long" })}. Your leagues are in it already.</p>
          <button type="button" onClick={() => setSeason(s.id)}>Take a look</button>
        </div>
      ))}
    </div>
  );
  if (!shown) return soonCard || null;
  const target = shown;
  // "the URC", but "the Nations Championship" rather than "the Nations".
  const comp = competitions.get(season.competition_id);
  const here = comp ? (/^[A-Z]+$/.test(comp.short_name) ? comp.short_name : comp.name) : season.name;
  // Only a tournament that has already kicked off can be resting; one still to come simply starts later.
  const started = matches.some((m) => new Date(m.kickoff_at).getTime() <= now);
  return (<>
    <div className="card also-on">
      <p>
        {started
          ? <><strong>{target.name}</strong> is on while the {here} rests. {roundName(other!.round)} starts {kickoff(other!.kickoff_at)}.</>
          : <><strong>{target.name}</strong> is on now, with {roundName(other!.round).toLowerCase()} starting {kickoff(other!.kickoff_at)}. The {here} starts {mine ? kickoff(mine) : startsIn(season.starts_on) ? `in ${startsIn(season.starts_on)}` : "later"}.</>}
      </p>
      <button type="button" onClick={() => setSeason(target.id)}>Play it</button>
    </div>
    {soonCard}
  </>);
}
