"use client";

import { useEffect, useState } from "react";
import { readCache, writeCache } from "@/lib/cache";
import { supabase } from "@/lib/supabase";

interface ClassRow { school_year: number; players: number; points: number | null; average: number | null; mine: boolean }

const RANKED_AT = 3;

/**
 * Class years at one school against each other, shown on a whole-school pool.
 * Each class counts its best 5 callers, so a big year can't win on numbers.
 */
export function ClassTable({ poolId }: { poolId: number }) {
  const key = `classes:${poolId}`;
  const [rows, setRows] = useState<ClassRow[] | null>(() => readCache<ClassRow[]>(key) ?? null);
  useEffect(() => {
    setRows(readCache<ClassRow[]>(key) ?? null);
    supabase.rpc("school_classes", { p_pool: poolId })
      .then(({ data }) => { const r = (data ?? []) as ClassRow[]; writeCache(key, r); setRows(r); });
  }, [key, poolId]);

  if (!rows || rows.length === 0) return null;
  const ranked = rows.filter((r) => r.average !== null)
    .sort((a, b) => Number(b.average) - Number(a.average) || b.players - a.players || a.school_year - b.school_year);
  const waiting = rows.filter((r) => r.average === null).sort((a, b) => b.players - a.players || b.school_year - a.school_year);
  const mine = ranked.findIndex((r) => r.mine);

  return (
    <section className="classes">
      <div className="classes-head">
        <h3>Class years</h3>
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
    </section>
  );
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
