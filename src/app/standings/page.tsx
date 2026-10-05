"use client";

import { useEffect, useState } from "react";
import { useLeague } from "@/components/league";
import { MatchesSwitch } from "@/components/matches-switch";
import { Team, stripe } from "@/components/team";
import { signed } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { StandingRow } from "@/lib/types";

export default function StandingsPage() {
  const { season, teams, competitions } = useLeague();
  const [log, setLog] = useState<StandingRow[]>([]);
  useEffect(() => {
    supabase.from("standings").select("*").eq("season", season.id).order("position")
      .then(({ data }) => setLog((data ?? []) as StandingRow[]));
  }, [season.id]);
  const pending = log.some((r) => !r.points_exact);

  return (
    <>
      <MatchesSwitch />
      <div className="card scroll-x">
        <h2>{competitions.get(season.competition_id)?.short_name ?? "The"} log</h2>
        <p className="sub">{season.name}. Updated after every result.</p>
        <table>
          <thead><tr>
            <th>#</th><th>Team</th><th className="num">P</th><th className="num">W</th><th className="num">D</th>
            <th className="num">L</th><th className="num hide-sm">PF</th><th className="num hide-sm">PA</th>
            <th className="num">Diff</th><th className="num">BP</th><th className="num">Pts</th>
          </tr></thead>
          <tbody>
            {log.map((r) => (
              <tr key={r.team_id} style={stripe(teams.get(r.team_id))}>
                <td className="muted">{r.position}</td>
                <td><Team team={teams.get(r.team_id)} /></td>
                <td className="num">{r.played}</td><td className="num">{r.won}</td><td className="num">{r.drawn}</td>
                <td className="num">{r.lost}</td><td className="num hide-sm">{r.points_for}</td>
                <td className="num hide-sm">{r.points_against}</td><td className="num">{signed(r.diff)}</td><td className="num">{r.bonus_points}{r.points_exact ? "" : "*"}</td>
                <td className="num"><strong>{r.log_points}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="notice">
        {season.is_replay
          ? "BP is bonus points, read off the season's published final table."
          : !season.wiki_page
          ? "BP is bonus points: 1 for losing by 7 or less. Try bonuses aren't counted for this tournament yet."
          : <>BP is bonus points: 1 for losing by 7 or less, and 1 for scoring four or more tries.{pending && " * means a try bonus from that team's latest match may still be added."}</>}
      </div>
    </>
  );
}
