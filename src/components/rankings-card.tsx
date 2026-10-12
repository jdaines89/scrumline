"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLeague } from "@/components/league";
import { provinceName } from "@/lib/crest";
import { readCache, writeCache } from "@/lib/cache";
import { supabase } from "@/lib/supabase";

type Stage = "high" | "primary";
interface SchoolRow { emis: string; name: string; score: number | null; rounds_counted: number; mine: boolean }
interface ProvinceRow { province: string; schools: number; score: number; mine: boolean }
interface EveryoneRow { pos: number | null; place: number | null; team_name: string; points: number; mine: boolean; players: number }

interface Place { rank: number | null; of: number; line: string }

const pts = (n: number, dp = 1) => n.toFixed(dp).replace(/\.0$/, "");

/** Where you stand in a table: your place, out of how many, and who you're chasing. */
function standing<T>(rows: T[], score: (r: T) => number, mine: (r: T) => boolean, name: (r: T) => string, top: string, dp = 1): Place | null {
  const me = rows.find(mine);
  if (!me) return null;
  const ahead = rows.filter((r) => score(r) > score(me));
  const rank = 1 + ahead.length;
  if (ahead.length === 0) {
    const tied = rows.some((r) => r !== me && score(r) === score(me));
    return { rank, of: rows.length, line: tied ? `Joint top of ${top}` : `Top of ${top}` };
  }
  const next = ahead.reduce((a, b) => (score(b) < score(a) ? b : a));
  return { rank, of: rows.length, line: `${pts(score(next) - score(me), dp)} behind ${name(next)}` };
}

/**
 * Rankings on the Leagues page, in the same cards as your leagues: your school,
 * your province and you among everyone, each with your place and who's next.
 * Reads the same cached tables as the Rankings page, so neither waits on the other.
 */
export function RankingsCard({ stage }: { stage: Stage | null }) {
  const { season } = useLeague();
  const sKey = `schools3:${season.id}:${stage ?? "high"}`;
  const pKey = `provinces2:${season.id}:${stage ?? "high"}`;
  const eKey = `sl:everyone:${season.id}`;
  const [schools, setSchools] = useState<SchoolRow[] | null>(() => (stage ? readCache<SchoolRow[]>(sKey) ?? null : null));
  const [provinces, setProvinces] = useState<ProvinceRow[] | null>(() => (stage ? readCache<ProvinceRow[]>(pKey) ?? null : null));
  const [everyone, setEveryone] = useState<EveryoneRow[] | null>(() => readCache<EveryoneRow[]>(eKey) ?? null);

  useEffect(() => {
    setEveryone(readCache<EveryoneRow[]>(eKey) ?? null);
    supabase.rpc("everyone_table", { p_season: season.id })
      .then(({ data, error }) => { if (error) return; const r = (data ?? []) as EveryoneRow[]; writeCache(eKey, r); setEveryone(r); });
    if (!stage) return;
    setSchools(readCache<SchoolRow[]>(sKey) ?? null);
    setProvinces(readCache<ProvinceRow[]>(pKey) ?? null);
    supabase.rpc("school_table", { p_season: season.id, p_stage: stage })
      .then(({ data, error }) => { if (error) return; const r = (data ?? []) as SchoolRow[]; writeCache(sKey, r); setSchools(r); });
    supabase.rpc("province_table", { p_season: season.id, p_stage: stage })
      .then(({ data, error }) => { if (error) return; const r = (data ?? []) as ProvinceRow[]; writeCache(pKey, r); setProvinces(r); });
  }, [season.id, stage, sKey, pKey, eKey]);

  const word = stage === "primary" ? "primary schools" : "high schools";
  const Word = stage === "primary" ? "Primary schools" : "High schools";

  // Your school: ranked ones by score; one not on the board yet still shows, with no place.
  const mySchool = schools?.find((r) => r.mine);
  const rankedSchools = (schools ?? []).filter((r) => r.score !== null);
  const school = mySchool && mySchool.score !== null
    ? standing(rankedSchools, (r) => Number(r.score), (r) => r.mine, (r) => r.name, `the ${word}`)
    : null;

  const myProvince = provinces?.find((r) => r.mine);
  const province = standing(provinces ?? [], (r) => Number(r.score), (r) => r.mine, (r) => provinceName(r.province), "the provinces");

  const meRow = everyone?.find((r) => r.mine);
  const players = everyone?.[0]?.players ?? 0;
  const ranked = (everyone ?? []).filter((r) => r.place !== null).sort((a, b) => a.pos! - b.pos!);
  const above = meRow?.place != null ? ranked.filter((r) => r.place! < meRow.place!).pop() : undefined;
  const tiedTop = meRow?.place === 1 && ranked.filter((r) => r.place === 1).length > 1;
  const you: Place | null = meRow
    ? meRow.place == null
      ? { rank: null, of: players, line: "Taking a break. Your next call puts you back on" }
      : { rank: meRow.place, of: players, line: above ? `${above.points - meRow.points} behind ${above.team_name}` : tiedTop ? "Joint top of all players" : "Top of all players" }
    : null;

  const rows: { key: string; tab: string; title: string; scope: string; place: Place | null; loading: boolean }[] = [];
  if (stage && (schools === null || mySchool)) {
    rows.push({ key: "s", tab: "schools", title: mySchool?.name ?? "Your school", scope: Word, loading: schools === null,
      place: school ?? (mySchool ? { rank: null, of: rankedSchools.length, line: "Not on the board yet. One scored call puts it there" } : null) });
  }
  if (stage && (provinces === null || myProvince)) {
    rows.push({ key: "p", tab: "provinces", title: myProvince ? provinceName(myProvince.province) : "Your province", scope: "Provinces", loading: provinces === null, place: province });
  }
  rows.push({ key: "e", tab: "everyone", title: "All players", loading: everyone === null, place: you,
    scope: everyone === null ? "Every player" : `${players.toLocaleString("en-ZA")} ${players === 1 ? "player" : "players"}` });

  return (
    <div className="lg-panel rk">
      <div className="lg-panel-head">
        <span className="rk-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" />
          </svg>
        </span>
        <span className="lg-panel-name">{season.name}</span>
        <Link className="lg-panel-link" href="/rankings/">See all ›</Link>
      </div>
      {rows.map((r) => {
        const big = (r.place?.rank ?? 0) >= 100;
        return (
          <div key={r.key} className={`lgc${r.place?.rank === 1 ? " rk-top" : ""}`}>
            <Link className="lgc-main" href={`/rankings/?tab=${r.tab}`}>
              <span className={`lgc-rank${big ? " big" : ""}`}>
                {r.place?.rank ? <>{r.place.rank.toLocaleString("en-ZA")}<small>of {r.place.of.toLocaleString("en-ZA")}</small></> : <small>—</small>}
              </span>
              <span className="lgc-text">
                <strong>{r.title}</strong>
                <span className="lgc-line">
                  {r.loading ? <span className="rk-wait">&nbsp;</span> : <>{r.scope}{r.place ? <> · {r.place.line}</> : null}</>}
                </span>
              </span>
              <span className="lgc-chev" aria-hidden="true">›</span>
            </Link>
          </div>
        );
      })}
    </div>
  );
}
