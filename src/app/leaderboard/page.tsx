"use client";

import { useEffect, useState } from "react";
import { ClassTable } from "@/components/class-table";
import { HeadToHead } from "@/components/head-to-head";
import { NeedsPool, useLeague } from "@/components/league";
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
import type { LeaderRow } from "@/lib/types";
import { PoolName } from "@/components/pool-name";

const PARTS = [
  ["res_pts", "RES"], ["mar_pts", "MAR"], ["cls_pts", "CLS"], ["exa_pts", "EXA"], ["banker_pts", "BNK"],
] as const satisfies readonly (readonly [keyof LeaderRow, string])[];

export default function LeaderboardPage() {
  return <NeedsPool><Leaderboard /></NeedsPool>;
}

function Leaderboard() {
  const { pool, me, season, matches } = useLeague();
  // null while the first copy loads; last visit's table shows instantly if this device has one.
  const [rows, setRows] = useState<LeaderRow[] | null>(() => readCache<LeaderRow[]>(`board:${pool!.id}`) ?? null);
  const [picked, setPicked] = useState<string | null>(null);
  const [view, setView] = useState<"overall" | "round" | "schools">("overall");
  const mine = rows?.find((r) => r.user_id === me.user_id)?.entry_id ?? null;
  // A whole-school pool can run to thousands: its classes race each other instead of a line per player.
  const wholeSchool = !!pool!.school_emis && !pool!.school_year;
  const [prizes, reloadPrizes] = usePoolPrizes(pool!.id);
  const sponsor = usePoolSponsor();
  const backers = useSeasonSponsors(season.id);
  const recruits = usePoolRecruits(pool!.id);
  const broughtIn = new Map(recruits.map((r) => [r.user_id, r.brought_in]));
  const top = pool!.school_emis ? topRecruiters(recruits) : null;
  useEffect(() => {
    setRows(readCache<LeaderRow[]>(`board:${pool!.id}`) ?? null);
    supabase.from("pool_leaderboard").select("*").eq("pool_id", pool!.id)
      .order("total_points", { ascending: false }).order("exact_scores", { ascending: false }).order("manager")
      .then(({ data }) => { const r = (data ?? []) as LeaderRow[]; writeCache(`board:${pool!.id}`, r); setRows(r); });
  }, [pool]);

  return (
    <div className="card">
      <h2>{view === "schools" ? "Schools" : <PoolName pool={pool!} />}</h2>
      <p className="sub">{season.name}. {view === "schools" ? "Every school in the league, not just this pool." : season.is_replay ? "Only rounds that are locked in count." : "Scores count once a match is played."}</p>
      <TournamentLine sponsors={backers} seasonName={season.name} round={currentRound(matches)} />
      {view !== "schools" && <SponsorLine sponsor={sponsor} />}
      {view !== "schools" && <PrizeLine prizes={prizes} onChange={reloadPrizes} />}
      {rows && view !== "schools" && <RoundRecap rows={rows} prizes={prizes} sponsor={sponsor} />}
      <div className="seg" role="tablist">
        <button type="button" role="tab" aria-selected={view === "overall"} className={view === "overall" ? "on" : ""} onClick={() => setView("overall")}>Overall</button>
        <button type="button" role="tab" aria-selected={view === "round"} className={view === "round" ? "on" : ""} onClick={() => setView("round")}>By round</button>
        <button type="button" role="tab" aria-selected={view === "schools"} className={view === "schools" ? "on" : ""} onClick={() => setView("schools")}>Schools</button>
      </div>
      {view === "schools" ? <SchoolTable /> : view === "round" ? (rows === null ? <SkeletonRows /> : <RoundTable rows={rows} />) : rows === null ? <SkeletonRows /> : rows.length === 0 ? <p className="muted">No one here yet.</p> : (
        <>
        {top && <TopRecruiter ids={top.ids} count={top.count} rows={rows} />}
        {wholeSchool ? <ClassTable poolId={pool!.id} /> : <PoolRace rows={rows} />}
        <ol className="board">
          {rows.map((r, i) => (
            <li key={r.user_id} className={`${r.user_id === me.user_id ? "me" : ""}${picked === r.user_id ? " open" : ""}`}
              onClick={() => r.entry_id && setPicked(picked === r.user_id ? null : r.user_id)}>
              <div className="brow">
                <span className="rank">{i + 1}</span>
                <div className="who">
                  <strong>{r.manager}</strong>
                  <span className="small muted">{r.team_name ?? "No team yet"} · {r.matches_scored} match{r.matches_scored === 1 ? "" : "es"} · {r.right_results} right result{r.right_results === 1 ? "" : "s"} · {r.exact_scores} exact{broughtIn.get(r.user_id) ? ` · brought in ${broughtIn.get(r.user_id)}` : ""}</span>
                </div>
                <span className="btotal">{r.total_points}</span>
              </div>
              <div className="bparts">
                {PARTS.map(([k, code]) => (
                  <span key={code} className={r[k] > 0 ? "pchip on" : "pchip"}>{code} {r[k]}</span>
                ))}
              </div>
              {picked === r.user_id && r.entry_id && <HeadToHead mine={mine} theirs={r.entry_id} name={r.manager} />}
            </li>
          ))}
        </ol>
        </>
      )}
      {view !== "schools" && <p className="small muted" style={{ marginTop: 12 }}>
        RES right result · MAR exact margin · CLS within 3 points · EXA exact score · BNK the extra your Banker doubled. They add up to the total.
        {view === "overall" && " Tap someone to compare rounds with yours."}
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
      {[0, 1, 2].map((i) => <li key={i} className="skeleton" style={{ height: 96 }} />)}
    </ol>
  );
}
