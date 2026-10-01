"use client";

import { useState } from "react";
import { useLeague } from "@/components/league";
import { MatchesSwitch } from "@/components/matches-switch";
import { RoundPicker, currentRound } from "@/components/round-picker";
import { Crest } from "@/components/team";
import type { Match } from "@/lib/types";

const SAST = "Africa/Johannesburg";
const day = (iso: string) => new Date(iso).toLocaleDateString("en-ZA", { timeZone: SAST, weekday: "long", day: "numeric", month: "long" });
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-ZA", { timeZone: SAST, hour: "2-digit", minute: "2-digit", hour12: false });

export default function FixturesPage() {
  const { rounds, matches, teams } = useLeague();
  const [round, setRound] = useState(() => currentRound(rounds, matches));
  const ms = matches.filter((m) => m.round === round);
  const days = new Map<string, Match[]>();
  for (const m of ms) days.set(day(m.kickoff_at), [...(days.get(day(m.kickoff_at)) ?? []), m]);

  return (
    <>
      <MatchesSwitch />
      <RoundPicker rounds={rounds} round={round} onPick={setRound} matches={matches} />
      {[...days].map(([d, list]) => (
        <div className="card" key={d}>
          <h2>{d}</h2>
          <p className="sub">Times are South African (SAST).</p>
          {list.map((m) => {
            const h = teams.get(m.home_team_id), a = teams.get(m.away_team_id);
            const played = m.home_score !== null;
            return (
              <div className="fixture" key={m.id}>
                <div className="fmeta">
                  <strong>{time(m.kickoff_at)}</strong>
                  {m.venue && <span>{m.venue}</span>}
                  {m.status === "POSTP" && <span className="badge loss">postponed</span>}
                  {m.status === "INTR" && <span className="badge draw">interrupted, score stood</span>}
                </div>
                <div className="fside">
                  <span className="ha home">Home</span>
                  {h && <Crest team={h} size={28} />}
                  <strong>{h?.display_name}</strong>
                  {played && <span className="fscore">{m.home_score}</span>}
                </div>
                <div className="fside">
                  <span className="ha">Away</span>
                  {a && <Crest team={a} size={28} />}
                  <strong>{a?.display_name}</strong>
                  {played && <span className="fscore">{m.away_score}</span>}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
