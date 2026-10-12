"use client";

import { Crest } from "@/components/team";
import { TournamentLogo } from "@/components/tournament-logo";
import type { Competition, Match, Team } from "@/lib/types";

const SAST = "Africa/Johannesburg";
export const fixtureDay = (iso: string) => new Date(iso).toLocaleDateString("en-ZA", { timeZone: SAST, weekday: "long", day: "numeric", month: "long" });
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-ZA", { timeZone: SAST, hour: "2-digit", minute: "2-digit", hour12: false });

/** One match: kick-off, venue, both sides. With a competition it also names the tournament (the combined calendar). */
export function FixtureCard({ m, teams, competition, round }: { m: Match; teams: Map<string, Team>; competition?: Competition; round?: string }) {
  const h = teams.get(m.home_team_id), a = teams.get(m.away_team_id);
  const played = m.home_score !== null;
  return (
    <div className="fixture">
      <div className="fmeta">
        <strong>{time(m.kickoff_at)}</strong>
        {m.venue && <span>{m.venue}</span>}
        {m.status === "POSTP" && <span className="badge loss">postponed</span>}
        {m.status === "INTR" && <span className="badge draw">interrupted, score stood</span>}
        {competition && <span className="fcomp"><TournamentLogo competition={competition} size={16} />{competition.short_name}{round ? ` · ${round}` : ""}</span>}
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
}
