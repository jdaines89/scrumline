"use client";

import { useEffect, useState } from "react";
import { readCache, writeCache } from "@/lib/cache";
import { roundName } from "@/lib/format";
import { supabase } from "@/lib/supabase";

interface BreakdownRound {
  round: number; turnout: number; counted: number; average: number; adds: number; running: number;
  players: { name: string; pts: number }[];
}
const NAMED = 3;

/**
 * Round by round, who played for a school and what each round gave it. The
 * rounds' points come from rounded running totals, so they always sum to the
 * score above. No formula wording on screen, by Justin's choice. A round with
 * more than a few players names three and opens to the full list on a tap.
 */
export function SchoolBreakdown({ emis, stage, season, total }: { emis: string; stage: "primary" | "high"; season: string; total: number }) {
  const key = `schoolhow1:${emis}:${stage}:${season}`;
  const [rows, setRows] = useState<BreakdownRound[] | null>(() => readCache<BreakdownRound[]>(key) ?? null);
  const [wide, setWide] = useState<number | null>(null);
  useEffect(() => {
    supabase.rpc("school_score_breakdown", { p_emis: emis, p_stage: stage, p_season: season })
      .then(({ data, error }) => { if (error) return; const r = (data ?? []) as BreakdownRound[]; writeCache(key, r); setRows(r); });
  }, [emis, key, season, stage]);
  return (
    <div className="sch-how-body">
      {rows === null ? (
        <div className="skeleton" style={{ height: 120 }} aria-busy="true" />
      ) : (
        <ol className="sch-how-list">
          {rows.map((r) => {
            const open = wide === r.round;
            const shown = open ? r.players : r.players.slice(0, NAMED);
            const more = r.players.length - NAMED;
            return (
              <li key={r.round}>
                <div>
                  <b>{roundName(r.round)}</b>
                  <span className="small muted">
                    {shown.map((x) => `${x.name} ${x.pts}`).join(" \u00b7 ")}
                    {more > 0 && (
                      <>{" \u00b7 "}<button type="button" className="sch-more" aria-expanded={open} onClick={() => setWide(open ? null : r.round)}>{open ? "Show fewer" : `${more} more`}</button></>
                    )}
                  </span>
                </div>
                <div className="sch-how-nums"><b>{Number(r.adds).toFixed(1)}</b></div>
              </li>
            );
          })}
          <li className="sch-how-total">
            <b>Total</b>
            <div className="sch-how-nums"><b>{total.toFixed(1)}</b></div>
          </li>
        </ol>
      )}
    </div>
  );
}
