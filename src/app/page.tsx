"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLeague } from "@/components/league";
import { Team, stripe } from "@/components/team";
import { kickoff } from "@/lib/format";
import { readCache, writeCache } from "@/lib/cache";
import { supabase } from "@/lib/supabase";
import type { StandingRow } from "@/lib/types";
import { TournamentLine } from "@/components/tournament-line";
import { useSeasonSponsors } from "@/lib/tournament-sponsor";
import { AlertsCard } from "@/components/alerts-card";
import { callingStreak, type Streak } from "@/lib/streak";

export default function Home() {
  const { season, matches, teams, me, entry } = useLeague();
  const [log, setLog] = useState<StandingRow[]>([]);
  const backers = useSeasonSponsors(season.id);
  useEffect(() => {
    setLog(readCache<StandingRow[]>(`toplog:${season.id}`) ?? []);
    supabase.from("standings").select("*").eq("season", season.id).order("position").limit(6)
      .then(({ data }) => { const r = (data ?? []) as StandingRow[]; writeCache(`toplog:${season.id}`, r); setLog(r); });
  }, [season.id]);

  const played = matches.filter((m) => m.home_score !== null);
  const lastRound = played.length ? Math.max(...played.map((m) => m.round)) : null;
  const latest = matches.filter((m) => m.round === lastRound);
  const upcoming = matches.filter((m) => m.home_score === null && new Date(m.kickoff_at).getTime() > Date.now());
  const nextRound = upcoming.length ? upcoming[0].round : null;
  const next = matches.filter((m) => m.round === nextRound);

  // How many of the next round's matches you've already called, so the nudge only shows when there's work left.
  const [called, setCalled] = useState<number | null>(null);
  const nextIds = next.map((m) => m.id).join(",");
  useEffect(() => {
    if (!entry || !nextIds) { setCalled(null); return; }
    setCalled(readCache<number>(`called:${entry.id}:${nextIds}`) ?? null);
    supabase.from("predictions").select("match_id", { count: "exact", head: true })
      .eq("entry_id", entry.id).in("match_id", nextIds.split(","))
      .then(({ count }) => { writeCache(`called:${entry.id}:${nextIds}`, count ?? 0); setCalled(count ?? 0); });
  }, [entry, nextIds]);
  // Every match you've called this season, for your calling streak.
  const [streak, setStreak] = useState<Streak | null>(null);
  useEffect(() => {
    if (!entry || !matches.length) { setStreak(null); return; }
    const key = `streak:${entry.id}`;
    const cached = readCache<string[]>(key);
    if (cached) setStreak(callingStreak(matches, new Set(cached)));
    supabase.from("predictions").select("match_id").eq("entry_id", entry.id).then(({ data }) => {
      const ids = ((data ?? []) as { match_id: string }[]).map((r) => r.match_id);
      writeCache(key, ids); setStreak(callingStreak(matches, new Set(ids)));
    });
  }, [entry, matches]);
  const allCalled = called !== null && called >= next.length;
  const nudge = nextRound === null || called === null ? null
    : allCalled ? <>All {next.length} calls are in for round {nextRound}. <Link href="/predict/">See them</Link>.</>
    : <>{called} of {next.length} called for round {nextRound}. <Link href="/predict/">Call the rest</Link>.</>;

  return (
    <>
      <div className="card">
        <h2>Hi {me.display_name}</h2>
        {season.is_replay && <p className="sub">Replay: the season has been played, so each of you locks a round in and then sees how it scored.</p>}
        {entry
          ? <p style={{ margin: 0 }}>Your team is <strong>{entry.team_name}</strong>.{nudge && <> {nudge}</>}</p>
          : <p style={{ margin: 0 }}><Link href="/predict/">Name your team</Link> to start playing.</p>}
        {streak && streak.rounds >= 2 && !season.is_replay && (
          <p className="small muted streak-line">
            {streak.rounds} rounds called in a row. {streak.forgiven ? "Your one free miss is used, so call every round to keep it." : "Miss one and it still holds."}
          </p>
        )}
        <TournamentLine sponsors={backers} seasonName={season.name} round={nextRound} />
      </div>
      <AlertsCard />
      <div className="grid2">
        {nextRound !== null && (
          <div className="card">
            <h2>Round {nextRound}</h2>
            <p className="sub">Up next{!allCalled && <> · <Link href="/predict/">call your scores</Link></>}</p>
            <table><tbody>
              {next.map((m) => (
                <tr key={m.id}>
                  <td style={{ textAlign: "right" }}><Team team={teams.get(m.home_team_id)} align="right" bold={false} /></td>
                  <td className="muted small" style={{ textAlign: "center", width: 86 }}>{kickoff(m.kickoff_at).replace(/^\w+, /, "")}</td>
                  <td><Team team={teams.get(m.away_team_id)} bold={false} /></td>
                </tr>
              ))}
            </tbody></table>
          </div>
        )}
        {lastRound !== null && (
          <div className="card">
            <h2>Round {lastRound}</h2>
            <p className="sub">Latest results</p>
            <table><tbody>
              {latest.map((m) => (
                <tr key={m.id}>
                  <td style={{ textAlign: "right" }}><Team team={teams.get(m.home_team_id)} align="right" bold={false} /></td>
                  <td className="score" style={{ textAlign: "center", width: 70 }}>{m.home_score}&ndash;{m.away_score}</td>
                  <td><Team team={teams.get(m.away_team_id)} bold={false} /></td>
                </tr>
              ))}
            </tbody></table>
          </div>
        )}
        {log.length > 0 && <div className="card">
          <h2>Top of the log</h2>
          <p className="sub"><Link href="/standings/">Full log</Link></p>
          <table>
            <thead><tr><th /><th /><th className="num">P</th><th className="num">Pts</th></tr></thead>
            <tbody>
            {log.map((r) => (
              <tr key={r.team_id} style={stripe(teams.get(r.team_id))}>
                <td className="muted" style={{ width: 28 }}>{r.position}</td>
                <td><Team team={teams.get(r.team_id)} /></td>
                <td className="num muted small" style={{ width: 40 }}>{r.played}</td>
                <td className="num" style={{ width: 44 }}><strong>{r.log_points}</strong></td>
              </tr>
            ))}
          </tbody></table>
        </div>}
      </div>
    </>
  );
}
