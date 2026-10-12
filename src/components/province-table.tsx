"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { useLeague } from "@/components/league";
import { provinceName, schoolHref } from "@/lib/crest";
import { readCache, writeCache } from "@/lib/cache";
import { supabase } from "@/lib/supabase";
import { SCHOOL_TRIAL } from "@/lib/school";

interface ProvinceRow {
  province: string; players: number; mine: boolean; score: number | null; rounds: number;
  top: { team_name: string; points: number; mine: boolean }[];
  schools: { emis: string; name: string; players: number }[];
}
const TEAM = 50;
const MINIMUM = SCHOOL_TRIAL ? 1 : 25;
const ALL = ["EC", "FS", "GP", "KZN", "LP", "MP", "NC", "NW", "WC"];

/**
 * Provinces against each other for this tournament. Players play for the
 * province of their school (high school first). Each round a province scores
 * the average of its best 50 players who played, so size alone doesn't win;
 * the season score adds the rounds up. Matches public.province_table().
 */
export function ProvinceTable() {
  const { season } = useLeague();
  const key = `provinces1:${season.id}`;
  const [rows, setRows] = useState<ProvinceRow[] | null>(() => readCache<ProvinceRow[]>(key) ?? null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    setRows(readCache<ProvinceRow[]>(key) ?? null);
    supabase.rpc("province_table", { p_season: season.id })
      .then(({ data, error }) => { if (error) return; const r = (data ?? []) as ProvinceRow[]; writeCache(key, r); setRows(r); });
  }, [key, season.id]);

  if (rows === null) {
    return (
      <ol className="board" aria-busy="true" aria-label="Loading the table">
        {[0, 1, 2].map((i) => <li key={i} className="skeleton" style={{ height: 66 }} />)}
      </ol>
    );
  }
  const ranked = rows.filter((r) => r.score !== null)
    .sort((a, b) => Number(b.score) - Number(a.score) || b.players - a.players || provinceName(a.province).localeCompare(provinceName(b.province)));
  const have = new Map(rows.map((r) => [r.province, r]));
  const waiting = ALL.filter((p) => !have.get(p) || have.get(p)!.score === null)
    .map((p) => have.get(p) ?? { province: p, players: 0, mine: false, score: null, rounds: 0, top: [], schools: [] })
    .sort((a, b) => b.players - a.players || provinceName(a.province).localeCompare(provinceName(b.province)));

  return (
    <>
      {ranked.length > 0 && (
        <ol className="board schools-table provinces">
          {ranked.map((r) => (
            <li key={r.province} className={r.mine ? "me" : ""}>
              <div className="srow">
                <span className="rank">{1 + ranked.filter((x) => Number(x.score) > Number(r.score)).length}</span>
                <span className="sname">{provinceName(r.province)}</span>
                <span className="btotal">{Number(r.score).toFixed(1)}</span>
                <Meta parts={[`${r.players.toLocaleString("en-ZA")} ${r.players === 1 ? "player" : "players"}`, `${r.rounds} ${r.rounds === 1 ? "round" : "rounds"}`]} />
                <button type="button" className="sch-how-btn srow-how" aria-expanded={open === r.province}
                  onClick={() => setOpen(open === r.province ? null : r.province)}>
                  Top players
                  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" className={open === r.province ? "up" : ""}><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              </div>
              {open === r.province && <ProvinceDetail row={r} />}
            </li>
          ))}
        </ol>
      )}
      {waiting.length > 0 && (
        <>
          {ranked.length > 0 && <p className="small muted school-waiting">Not ranked yet</p>}
          <ol className="board schools-table provinces waiting">
            {waiting.map((r) => (
              <li key={r.province} className={r.mine ? "me" : ""}>
                <div className="srow">
                  <span className="rank blank" aria-hidden />
                  <span className="sname">{provinceName(r.province)}</span>
                  <Meta parts={r.players === 0 ? ["No players yet"] : [`${r.players} ${r.players === 1 ? "player" : "players"}`, "ranked after a scored call"]} />
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
      <p className="small muted" style={{ marginTop: 12 }}>
        You play for the province of your school. Every round, a province scores the average of its best {TEAM} players
        who played that round, so a smaller province can beat a bigger one. The table adds the rounds up.
        {SCHOOL_TRIAL
          ? " For now every player counts straight away, as on the schools table."
          : ` At least ${MINIMUM} confirmed players have to play for a round to count.`}
      </p>
    </>
  );
}

/** A province's top five teams and the schools with the most players in it. */
function ProvinceDetail({ row }: { row: ProvinceRow }) {
  return (
    <div className="sch-how-body">
      <ol className="sch-how-list">
        {row.top.map((t, i) => (
          <li key={i} className={t.mine ? "me" : ""}>
            <div><b>{t.team_name}</b></div>
            <div className="sch-how-nums"><b>{t.points}</b></div>
          </li>
        ))}
      </ol>
      {row.schools.length > 0 && (
        <>
          <p className="small muted" style={{ margin: "12px 0 4px" }}>Most players from</p>
          <ol className="sch-how-list">
            {row.schools.map((s) => (
              <li key={s.emis}>
                <div><Link href={schoolHref(s.emis)} className="sch-link">{s.name}</Link></div>
                <div className="sch-how-nums"><span className="small muted">{s.players} {s.players === 1 ? "player" : "players"}</span></div>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function Meta({ parts }: { parts: string[] }) {
  return (
    <span className="smeta small muted">
      {parts.map((p, i) => <Fragment key={i}>{i > 0 && " · "}<span>{p}</span></Fragment>)}
    </span>
  );
}
