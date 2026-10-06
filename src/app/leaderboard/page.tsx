"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ClassTable } from "@/components/class-table";
import { HeadToHead } from "@/components/head-to-head";
import { NeedsPool, useLeague } from "@/components/league";
import { PlayerCard } from "@/components/player-card";
import { PoolRace } from "@/components/pool-race";
import { PrizeLine } from "@/components/prize-line";
import { currentRound, SponsorLine, usePoolSponsor } from "@/components/sponsor-line";
import { TournamentLine } from "@/components/tournament-line";
import { useSeasonSponsors } from "@/lib/tournament-sponsor";
import { RoundRecap } from "@/components/round-recap";
import { RoundTable } from "@/components/round-table";
import { SchoolTable } from "@/components/school-table";
import { readCache, writeCache } from "@/lib/cache";
import { supabase } from "@/lib/supabase";
import { usePoolPrizes } from "@/lib/prizes";
import { plural, topRecruiters, usePoolRecruits } from "@/lib/recruits";
import { usePoolRecruiterPrizes } from "@/lib/recruiter-prizes";
import { RecruiterPrizeLine } from "@/components/recruiter-prize";
import type { LeaderRow } from "@/lib/types";
import { PoolName } from "@/components/pool-name";
import { fullName, useSchoolLabels } from "@/lib/names";
import { ord } from "@/lib/growth";
import { roundText } from "@/lib/format";

const PARTS = [
  ["res_pts", "RES"], ["mar_pts", "MAR"], ["cls_pts", "CLS"], ["exa_pts", "EXA"], ["banker_pts", "BNK"],
] as const satisfies readonly (readonly [keyof LeaderRow, string])[];

export default function LeaderboardPage() {
  return <NeedsPool><Leaderboard /></NeedsPool>;
}

function Leaderboard() {
  const { pool, me, members, season, matches } = useLeague();
  const schools = useSchoolLabels();
  const person = (uid: string) => members.find((m) => m.user_id === uid);
  // null while the first copy loads; last visit's table shows instantly if this device has one.
  const [rows, setRows] = useState<LeaderRow[] | null>(() => readCache<LeaderRow[]>(`board:${pool!.id}`) ?? null);
  const [picked, setPicked] = useState<string | null>(null);
  const [profile, setProfile] = useState<string | null>(null);
  const [view, setView] = useState<"overall" | "round" | "schools">("overall");
  // ?tab=schools opens the schools table straight away (a school's page links here).
  useEffect(() => { if (new URLSearchParams(window.location.search).get("tab") === "schools") setView("schools"); }, []);
  const mine = rows?.find((r) => r.user_id === me.user_id)?.entry_id ?? null;
  // A whole-school pool can run to thousands: its classes race each other instead of a line per player.
  const wholeSchool = !!pool!.school_emis && !pool!.school_year;
  const [prizes, reloadPrizes] = usePoolPrizes(pool!.id);
  const sponsor = usePoolSponsor();
  const backers = useSeasonSponsors(season.id);
  const recruits = usePoolRecruits(pool!.id);
  const broughtIn = new Map(recruits.map((r) => [r.user_id, r.brought_in]));
  const [recruiterPrizes, reloadRecruiterPrizes] = usePoolRecruiterPrizes(pool!.id);
  // Mirrors what PrizeLine shows: a round in play or coming up, or a round prize you won and haven't marked received.
  const roundPrizeShowing = prizes.some((p) => p.status === "in play" || p.status === "upcoming"
    || (p.status === "awaiting" && !!p.winners?.includes(me.user_id) && !p.received.includes(me.user_id)));
  // A running recruiter prize names who's ahead by its own rule, so the plain thanks line steps aside.
  const prizeRunning = recruiterPrizes.some((p) => p.status === "open" || p.status === "counting");
  const top = pool!.school_emis && !prizeRunning ? topRecruiters(recruits) : null;
  useEffect(() => {
    setRows(readCache<LeaderRow[]>(`board:${pool!.id}`) ?? null);
    supabase.from("pool_leaderboard").select("*").eq("pool_id", pool!.id)
      .order("total_points", { ascending: false }).order("exact_scores", { ascending: false }).order("manager")
      .then(({ data }) => { const r = (data ?? []) as LeaderRow[]; writeCache(`board:${pool!.id}`, r); setRows(r); });
  }, [pool]);

  // Members with no calls in their last two rounds sit under the table, points kept, until they call again.
  const playing = rows?.filter((r) => !r.resting) ?? [];
  const resting = rows?.filter((r) => r.resting) ?? [];
  const meResting = resting.find((r) => r.user_id === me.user_id);

  // The table comes first; what's up for grabs sits straight under it.
  const prizeBlock = (
    <div className="board-prizes">
      <PrizeLine prizes={prizes} onChange={reloadPrizes} />
      <RecruiterPrizeLine prizes={recruiterPrizes} onChange={reloadRecruiterPrizes} compact={roundPrizeShowing} />
    </div>
  );

  const row = (r: LeaderRow, rank: number | null) => (
    <li key={r.user_id} className={`${r.user_id === me.user_id ? "me" : ""}${picked === r.user_id ? " open" : ""}`}
      onClick={() => r.entry_id && setPicked(picked === r.user_id ? null : r.user_id)}>
      <div className="brow">
        <span className="rank">{rank ?? "–"}</span>
        <div className="who">
          <strong>{r.team_name ?? r.manager}</strong>
          <span className="small muted bname">{fullName(person(r.user_id)) || r.manager}</span>
          {schools.get(r.user_id) && <span className="small bschool">{schools.get(r.user_id)}</span>}
        </div>
        <span className="btotal">{r.total_points}</span>
      </div>
      {picked === r.user_id && (
        <div className="bmore">
          <button type="button" className="bprofile" onClick={(e) => { e.stopPropagation(); setProfile(r.user_id); }}>
            View {r.user_id === me.user_id ? "your" : `${person(r.user_id)?.known_as ?? person(r.user_id)?.first_name ?? r.manager}'s`} profile ›
          </button>
          <p className="small muted">{r.matches_scored} match{r.matches_scored === 1 ? "" : "es"} · {r.right_results} right result{r.right_results === 1 ? "" : "s"} · {r.exact_scores} exact{broughtIn.get(r.user_id) ? ` · brought in ${broughtIn.get(r.user_id)}` : ""}</p>
          <div className="bparts">
            {PARTS.map(([k, code]) => (
              <span key={code} className={r[k] > 0 ? "pchip on" : "pchip"}>{code} {r[k]}</span>
            ))}
          </div>
        </div>
      )}
      {picked === r.user_id && r.entry_id && <HeadToHead mine={mine} theirs={r.entry_id} name={r.team_name ?? r.manager} />}
    </li>
  );

  return (
    <div className="card">
      <Link href="/leagues/" className="lg-back">‹ Your leagues</Link>
      <h2>{view === "schools" ? "Schools" : <PoolName pool={pool!} />}</h2>
      {view === "schools" && <p className="sub">Every school in the league, not just this league.</p>}
      {/* One sponsor line and one prize panel: the pool's own sponsor beats the tournament's, the round prize beats the recruiter prize. */}
      {view !== "schools" && sponsor ? <SponsorLine sponsor={sponsor} />
        : <TournamentLine sponsors={backers} seasonName={season.name} round={currentRound(matches)} single />}
      <div className="seg" role="tablist">
        <button type="button" role="tab" aria-selected={view === "overall"} className={view === "overall" ? "on" : ""} onClick={() => setView("overall")}>Overall</button>
        <button type="button" role="tab" aria-selected={view === "round"} className={view === "round" ? "on" : ""} onClick={() => setView("round")}>By round</button>
        <button type="button" role="tab" aria-selected={view === "schools"} className={view === "schools" ? "on" : ""} onClick={() => setView("schools")}>Schools</button>
      </div>
      {view === "schools" ? <SchoolTable /> : view === "round" ? (rows === null ? <SkeletonRows /> : <><RoundTable rows={rows} />{prizeBlock}</>) : rows === null ? <SkeletonRows /> : rows.length === 0 ? <p className="muted">No one here yet.</p> : (
        <>
        {top && <TopRecruiter ids={top.ids} count={top.count} rows={rows} />}
        {wholeSchool ? <ClassTable poolId={pool!.id} /> : <PoolRace rows={playing} />}
        {meResting && <BreakCard me={meResting} playing={playing} matches={matches} />}
        <ol className="board">{playing.map((r, i) => row(r, i + 1))}</ol>
        {resting.length > 0 && (
          <details className="board-break" open={!!meResting}>
            <summary>Taking a break <span className="muted">· {resting.length}</span></summary>
            <p className="small muted">No calls in their last two rounds. Their points are kept, and their next call puts them straight back in the table.</p>
            <ol className="board resting">{resting.map((r) => row(r, null))}</ol>
          </details>
        )}
        {prizeBlock}
        <RoundRecap rows={rows} prizes={prizes} sponsor={sponsor} />
        {profile && person(profile) && <PlayerCard member={person(profile)!} onClose={() => setProfile(null)} />}
        </>
      )}
      {view === "overall" && rows && rows.length > 0 && <p className="small muted" style={{ marginTop: 12 }}>
        {picked ? "RES right result · MAR exact margin · CLS within 3 points · EXA exact score · BNK the extra your Banker doubled." : "Tap a team to see their points and compare rounds."}
      </p>}
    </div>
  );
}

// A school pool's thanks to whoever brought the most new players in this month.
function TopRecruiter({ ids, count, rows }: { ids: string[]; count: number; rows: LeaderRow[] }) {
  const names = ids.map((id) => rows.find((r) => r.user_id === id)?.manager).filter(Boolean) as string[];
  if (names.length === 0) return null;
  const month = new Date().toLocaleString("en-ZA", { month: "long", timeZone: "Africa/Johannesburg" });
  const who = names.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
  return (
    <p className="small muted recruiter">
      Top recruiter in {month}: <strong>{who}</strong>, {plural(count, "new player", "new players")}{names.length > 1 ? " each" : ""}
    </p>
  );
}

// Placeholder cards the same size as the real ones, so nothing jumps when the table arrives.
function SkeletonRows() {
  return (
    <ol className="board" aria-busy="true" aria-label="Loading the table">
      {[0, 1, 2].map((i) => <li key={i} className="skeleton" style={{ height: 64 }} />)}
    </ol>
  );
}

// A calm nudge for someone on a break: their points are safe and one call puts them back in.
function BreakCard({ me, playing, matches }: { me: LeaderRow; playing: LeaderRow[]; matches: { round: number; kickoff_at: string }[] }) {
  const back = playing.filter((r) => r.total_points > me.total_points).length + 1;
  const now = Date.now();
  const next = matches.filter((m) => new Date(m.kickoff_at).getTime() > now).map((m) => m.round);
  const round = next.length ? Math.min(...next) : null;
  return (
    <div className="break-card">
      <strong>You&apos;re taking a break</strong>
      <p className="small muted">No calls in your last two rounds, so you&apos;re listed under the table for now. Your {me.total_points} points are safe.</p>
      <p className="small">{round !== null ? `Call ${roundText(round)}` : "Make your next call"} and you&apos;re straight back in at {ord(back)}.</p>
      <Link className="btn" href="/predict/">Make your calls</Link>
    </div>
  );
}
