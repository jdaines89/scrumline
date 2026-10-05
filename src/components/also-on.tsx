"use client";

import { useEffect, useState } from "react";
import { useLeague } from "@/components/league";
import { kickoff } from "@/lib/format";
import { worthSwitching, type NextUp } from "@/lib/seasons";
import { supabase } from "@/lib/supabase";

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
  if (!worthSwitching(mine, other, now)) return null;
  const target = seasons.find((s) => s.id === other!.season);
  if (!target) return null;
  // "the URC rests", but "the Nations Championship rests" rather than "the Nations".
  const comp = competitions.get(season.competition_id);
  const resting = comp ? (/^[A-Z]+$/.test(comp.short_name) ? comp.short_name : comp.name) : season.name;
  return (
    <div className="card also-on">
      <p>
        <strong>{target.name}</strong> is on while the {resting} rests. Round {other!.round} starts {kickoff(other!.kickoff_at)}.
      </p>
      <button type="button" onClick={() => setSeason(target.id)}>Play it</button>
    </div>
  );
}
