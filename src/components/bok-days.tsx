"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLeague } from "@/components/league";
import { BOKS, type BokTest } from "@/lib/bok-tests";
import { readCache, writeCache } from "@/lib/cache";
import { dayHeading, kickTime } from "@/lib/format";
import { fullName } from "@/lib/names";
import { bokYear, rankBokDays, type BokDaysRow } from "@/lib/bok-days";
import { supabase } from "@/lib/supabase";

/**
 * The league's table for the Springboks' tests only, for people who follow the
 * Boks and nothing else. Same calls as the tournament tables, so nobody calls
 * twice; the Banker doesn't count here.
 */
export function BokDaysTable() {
  const { pool, me, members, seasons, teams, setSeason } = useLeague();
  const league = pool!.league_id ?? pool!.id;
  const year = bokYear();
  const key = `bokdays:${league}:${year}`;
  const [rows, setRows] = useState<BokDaysRow[] | null>(() => readCache<BokDaysRow[]>(key) ?? null);
  const [tests, setTests] = useState<BokTest[]>(() => readCache<BokTest[]>(`bok-year:${year}`) ?? []);
  const live = seasons.filter((s) => !s.is_replay).map((s) => s.id).join(",");

  useEffect(() => {
    setRows(readCache<BokDaysRow[]>(key) ?? null);
    supabase.from("bok_days_table").select("*").eq("league_id", league).eq("year", year)
      .then(({ data }) => { const r = (data ?? []) as BokDaysRow[]; writeCache(key, r); setRows(r); });
  }, [key, league, year]);

  useEffect(() => {
    if (!live) return;
    supabase.from("matches").select("id, season, kickoff_at, home_team_id, away_team_id, venue")
      .in("season", live.split(",")).or(`home_team_id.eq.${BOKS},away_team_id.eq.${BOKS}`)
      .gte("kickoff_at", `${year}-01-01`).lt("kickoff_at", `${year + 1}-01-01`).order("kickoff_at")
      .then(({ data }) => { const r = (data ?? []) as BokTest[]; writeCache(`bok-year:${year}`, r); setTests(r); });
  }, [live, year]);

  const person = (uid: string) => members.find((m) => m.user_id === uid);
  const name = (id: string) => teams.get(id)?.display_name ?? "";
  const now = Date.now();
  const next = tests.find((t) => new Date(t.kickoff_at).getTime() > now);
  const played = tests.filter((t) => new Date(t.kickoff_at).getTime() <= now).length;
  const ranked = rankBokDays(rows ?? []);

  return (
    <>
      <p className="sub">
        Only the Springboks&apos; tests count here, so you can call just the Bok game each Bok weekend.
        It uses the calls you already make, and the Banker doesn&apos;t count.
      </p>
      {tests.length > 0 && (
        <ul className="bok-list bokdays-tests">
          {tests.map((t) => {
            const done = new Date(t.kickoff_at).getTime() <= now;
            return (
              <li key={t.id} className={done ? "done" : ""}>
                <span className="bok-when">{dayHeading(t.kickoff_at)} · {kickTime(t.kickoff_at)}</span>
                <strong>{name(t.home_team_id)} v {name(t.away_team_id)}</strong>
              </li>
            );
          })}
        </ul>
      )}
      {next && (
        <Link href="/predict/" className="btn bokdays-call" onClick={() => setSeason(next.season)}>
          Call {name(next.home_team_id === BOKS ? next.away_team_id : next.home_team_id)} v the Boks
        </Link>
      )}
      {rows === null ? (
        <ol className="board" aria-busy="true" aria-label="Loading the table">
          {[0, 1].map((i) => <li key={i} className="skeleton" style={{ height: 64 }} />)}
        </ol>
      ) : ranked.length === 0 ? (
        <p className="muted bokdays-empty">
          {tests.length === 0 ? `No Bok tests on Scrumline yet for ${year}.`
            : played === 0 ? "The table fills up after the first Bok test."
            : "No one in this league has called a Bok test yet."}
        </p>
      ) : (
        <ol className="board">
          {ranked.map((r) => (
            <li key={r.user_id} className={r.user_id === me.user_id ? "me" : ""}>
              <div className="brow">
                <span className="rank">{1 + ranked.filter((x) => Number(x.points) > Number(r.points)).length}</span>
                <div className="who">
                  <strong>{fullName(person(r.user_id)) || r.display_name}</strong>
                  <span className="small muted bname">
                    {r.tests_called} of {played} Bok {played === 1 ? "test" : "tests"} · {r.exact_scores} exact
                  </span>
                </div>
                <span className="btotal">{r.points}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
