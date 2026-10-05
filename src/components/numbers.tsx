"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { setPreview, usePreview } from "@/lib/preview";
import { roundName } from "@/lib/format";

interface Week { week: string; players: number; new_players: number; active: number; callers: number; returners: number; retained: number | null; calls: number }
interface Round { round: number; teams: number; callers: number; share: number | null }

const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);
const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });

/** Admin-only retention numbers: weekly activity and round-by-round participation. */
/** Fills the sponsor features with sample data on this device, to see how they look. */
function PreviewToggle() {
  const on = usePreview();
  return (
    <label className="small muted toggle" style={{ margin: "0 0 12px" }}>
      <input type="checkbox" checked={on} onChange={(e) => setPreview(e.target.checked)} />
      Preview sponsor features with sample data (only you see it, on this device)
    </label>
  );
}

export function Numbers({ season, seasonName }: { season: string; seasonName: string }) {
  const [weeks, setWeeks] = useState<Week[] | null>(null);
  const [rounds, setRounds] = useState<Round[]>([]);
  useEffect(() => {
    supabase.rpc("weekly_metrics", { p_weeks: 8 }).then(({ data }) => setWeeks((data ?? []) as Week[]));
    supabase.rpc("round_participation", { p_season: season })
      .then(({ data }) => setRounds(((data ?? []) as Round[]).filter((r) => r.callers > 0)));
  }, [season]);
  if (!weeks) return null;
  return (
    <div className="card">
      <h2>Numbers</h2>
      <PreviewToggle />
      <p className="sub">Only admins see this. Opens were first counted on 26 Sep, so earlier weeks show calls and chat only.</p>
      <div className="scroll-x">
        <table>
          <thead><tr><th>Week of</th><th className="num">Players</th><th className="num">Active</th><th className="num">Called</th><th className="num">Came back</th><th className="num">Calls</th></tr></thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.week}>
                <td>{day(w.week)}</td>
                <td className="num">{w.players}{w.new_players > 0 && <span className="muted"> +{w.new_players}</span>}</td>
                <td className="num">{w.active}</td>
                <td className="num">{w.callers}</td>
                <td className="num">{pct(w.retained)}</td>
                <td className="num">{w.calls}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rounds.length > 0 && (
        <>
          <h3 className="numbers-h">{seasonName}: players who called each round</h3>
          <div className="scroll-x">
          <table>
            <tbody>
              {rounds.map((r) => (
                <tr key={r.round}><td>{roundName(r.round)}</td><td className="num">{r.callers} of {r.teams}</td><td className="num">{pct(r.share)}</td></tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </div>
  );
}
