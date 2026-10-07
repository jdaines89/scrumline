"use client";

import { useEffect, useState } from "react";
import { readCache, writeCache } from "@/lib/cache";
import { ShareMomentButton } from "@/components/share-moment";
import { supabase } from "@/lib/supabase";

interface ClassRow { school_year: number; players: number; points: number | null; average: number | null; mine: boolean }

const RANKED_AT = 3;

/** The school a table is for: a whole-school league, or a school page's school, stage and tournament. */
type Source = { poolId: number } | { emis: string; stage: "primary" | "high"; season: string; school: string };

/**
 * Class years at one school against each other, on a whole-school league and on the school's page.
 * Each class counts its best 5 callers, so a big year can't win on numbers.
 */
export function ClassTable(src: Source) {
  const byPool = "poolId" in src;
  const key = byPool ? `classes:${src.poolId}` : `classes:${src.emis}:${src.stage}:${src.season}`;
  const [rows, setRows] = useState<ClassRow[] | null>(() => readCache<ClassRow[]>(key) ?? null);
  useEffect(() => {
    setRows(readCache<ClassRow[]>(key) ?? null);
    const call = "poolId" in src
      ? supabase.rpc("school_classes", { p_pool: src.poolId })
      : supabase.rpc("school_classes_at", { p_emis: src.emis, p_stage: src.stage, p_season: src.season });
    call.then(({ data }) => { const r = (data ?? []) as ClassRow[]; writeCache(key, r); setRows(r); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!rows || rows.length === 0) return null;
  const ranked = rows.filter((r) => r.average !== null)
    .sort((a, b) => Number(b.average) - Number(a.average) || b.players - a.players || a.school_year - b.school_year);
  const waiting = rows.filter((r) => r.average === null).sort((a, b) => b.players - a.players || b.school_year - a.school_year);
  const mine = ranked.findIndex((r) => r.mine);
  // Your class, when it's out in front on its own.
  const first = mine === 0 && (ranked.length < 2 || Number(ranked[1].average) < Number(ranked[0].average)) ? ranked[0] : null;

  return (
    <section className={byPool ? "classes" : "card narrow classes classes-school"}>
      <div className="classes-head">
        {byPool ? <h3>Class years</h3> : <h2>Class years</h2>}
        <span className="small muted">
          {mine >= 0 ? `Your class is ${ordinal(mine + 1)} of ${ranked.length}` : `${ranked.length} ranked`}
        </span>
      </div>
      {ranked.length > 0 && (
        <ol className="board classes-table">
          {ranked.map((r) => (
            <li key={r.school_year} className={r.mine ? "me" : ""}>
              <div className="brow">
                <span className="rank">{1 + ranked.filter((x) => Number(x.average) > Number(r.average)).length}</span>
                <div className="who">
                  <strong>Class of {r.school_year}</strong>
                  <span className="small muted">{r.players} player{r.players === 1 ? "" : "s"}</span>
                </div>
                <span className="btotal">{Number(r.average).toFixed(1)}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
      {waiting.length > 0 && (
        <p className="small muted classes-waiting">
          Not ranked yet: {waiting.map((r) => `${r.mine ? "your class, " : ""}${r.school_year} (${r.players} of ${RANKED_AT})`).join(", ")}.
        </p>
      )}
      <p className="small muted">Each class counts its best 5 callers this tournament. An empty place counts as 0.</p>
      {!byPool && first && ranked.length >= 2 && (
        <div className="classes-share">
          <span className="small">Your class is top of {src.school}.</span>
          <ShareMomentButton moment={{
            kind: "class_lead", kicker: "Top class", headline: `Class of ${first.school_year}`,
            detail: `Leading ${src.school}, 1st of ${ranked.length} class years.`, said: "",
          }} />
        </div>
      )}
    </section>
  );
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
