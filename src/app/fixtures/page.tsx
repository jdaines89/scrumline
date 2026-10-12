"use client";

import { useState } from "react";
import { useLeague } from "@/components/league";
import { MatchesSwitch } from "@/components/matches-switch";
import { RoundPicker, currentRound } from "@/components/round-picker";
import { CombinedCalendar } from "@/components/combined-calendar";
import { FixtureCard, fixtureDay as day } from "@/components/fixture-card";
import type { Match } from "@/lib/types";
import { Tabs } from "@/components/tabs";

export default function FixturesPage() {
  const { season, rounds, matches, teams } = useLeague();
  const [round, setRound] = useState(() => currentRound(rounds, matches));
  const [all, setAll] = useState(false);
  // Switching tournament starts on that tournament's own current round, not the same number.
  const [roundOf, setRoundOf] = useState(season.id);
  if (roundOf !== season.id) { setRoundOf(season.id); setRound(currentRound(rounds, matches)); }
  const ms = matches.filter((m) => m.round === round);
  const days = new Map<string, Match[]>();
  for (const m of ms) days.set(day(m.kickoff_at), [...(days.get(day(m.kickoff_at)) ?? []), m]);

  if (all) return (
    <>
      <MatchesSwitch />
      <Scope all={all} onPick={setAll} />
      <CombinedCalendar />
    </>
  );
  return (
    <>
      <MatchesSwitch />
      <Scope all={all} onPick={setAll} />
      <RoundPicker rounds={rounds} round={round} onPick={setRound} matches={matches} />
      {[...days].map(([d, list], i) => (
        <div className="card" key={d}>
          <h2>{d}</h2>
          {i === 0 && <p className="sub">Kick-off times are South African time.</p>}
          {list.map((m) => <FixtureCard key={m.id} m={m} teams={teams} />)}
        </div>
      ))}
    </>
  );
}

/** One tournament's rounds, or every tournament together by date. */
function Scope({ all, onPick }: { all: boolean; onPick: (v: boolean) => void }) {
  return (
    <Tabs size="sub" label="Which tournaments" items={[["one", "This tournament"], ["all", "All tournaments"]] as const}
      value={all ? "all" : "one"} onPick={(v) => onPick(v === "all")} />
  );
}
