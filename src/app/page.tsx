"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLeague } from "@/components/league";
import { Team, stripe } from "@/components/team";
import { Avatar } from "@/components/avatar";
import { dayHeading, kickTime, roundName } from "@/lib/format";
import { readCache, writeCache } from "@/lib/cache";
import { supabase } from "@/lib/supabase";
import type { StandingRow } from "@/lib/types";
import { TournamentLine } from "@/components/tournament-line";
import { useSeasonSponsors } from "@/lib/tournament-sponsor";
import { AlertsCard } from "@/components/alerts-card";
import { SeasonAhead } from "@/components/season-ahead";
import { AlsoOn } from "@/components/also-on";
import { BringAMate } from "@/components/bring-a-mate";
import { BokTests } from "@/components/bok-tests";
import { FullTimeCard } from "@/components/full-time";
import { SchoolMeter } from "@/components/school-meter";

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
  const allCalled = called !== null && called >= next.length;

  return (
    <>
      <div className="card teamcard">
        <div className="tc-head">
          <Avatar member={me} size={42} />
          <div className="tc-who">
            <span className="tc-hi">Hi {me.display_name}</span>
            {entry
              ? <h2 className="tc-name">{entry.team_name}</h2>
              : <h2 className="tc-name tc-none">No team yet</h2>}
          </div>
        </div>
        {season.is_replay && <p className="sub tc-replay">Replay: the season has been played, so each of you locks a round in and then sees how it scored.</p>}
        {!entry && <Link className="btn tc-go" href="/predict/">Name your team</Link>}
        {entry && nextRound !== null && (
          <div className="tc-round">
            <div className="tc-round-line">
              <span className="tc-round-name">{roundName(nextRound)}</span>
              <span className="tc-count">{called === null ? "\u00a0" : allCalled ? `All ${next.length} called` : `${called} of ${next.length} called`}</span>
            </div>
            <div className="tc-bar" aria-hidden="true">
              {next.map((m, i) => <span key={m.id} className={called !== null && i < called ? "on" : ""} />)}
            </div>
            <Link className={`btn tc-go${allCalled ? " done" : ""}`} href="/predict/">
              {allCalled ? "See your calls" : called ? "Call the rest" : "Call your scores"}
            </Link>
          </div>
        )}
        <div className="home-backers"><TournamentLine sponsors={backers} seasonName={season.name} round={nextRound} /></div>
      </div>
      {!season.is_replay && <FullTimeCard />}
      <SeasonAhead />
      <AlsoOn />
      {!season.is_replay && <BokTests />}
      {!season.is_replay && <SchoolMeter />}
      {!season.is_replay && <BringAMate season={season.id} seasonName={season.name} />}
      <AlertsCard />
      <div className="grid2">
        {nextRound !== null && (
          <div className="card">
            <h2>{roundName(nextRound)}</h2>
            <p className="sub">Up next{!allCalled && <> · <Link href="/predict/">call your scores</Link></>}</p>
            <div className="fx">
              {next.map((m, i) => (
                <div key={m.id}>
                  {(i === 0 || dayHeading(m.kickoff_at) !== dayHeading(next[i - 1].kickoff_at)) && <div className="fx-day">{dayHeading(m.kickoff_at)}</div>}
                  <div className="fx-row">
                    <span className="fx-team home"><Team team={teams.get(m.home_team_id)} align="right" bold={false} /></span>
                    <span className="fx-time">{kickTime(m.kickoff_at)}</span>
                    <span className="fx-team"><Team team={teams.get(m.away_team_id)} bold={false} /></span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {lastRound !== null && (
          <div className="card">
            <h2>{roundName(lastRound)}</h2>
            <p className="sub">Latest results</p>
            <div className="fx">
              {latest.map((m) => (
                <div key={m.id} className="fx-row">
                  <span className="fx-team home"><Team team={teams.get(m.home_team_id)} align="right" bold={false} /></span>
                  <span className="fx-time score">{m.home_score}&ndash;{m.away_score}</span>
                  <span className="fx-team"><Team team={teams.get(m.away_team_id)} bold={false} /></span>
                </div>
              ))}
            </div>
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
