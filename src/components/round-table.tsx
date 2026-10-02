"use client";

import { useEffect, useMemo, useState } from "react";
import { useLeague } from "@/components/league";
import { RoundPicker } from "@/components/round-picker";
import { readCache, writeCache } from "@/lib/cache";
import { supabase } from "@/lib/supabase";
import type { LeaderRow } from "@/lib/types";

interface Scored { entry_id: number; round: number; total_pts: number; result_pts: number; margin_pts: number; near_pts: number; exact_pts: number }

// The same breakdown as the overall table, for one round.
const PARTS = [["res", "RES"], ["mar", "MAR"], ["cls", "CLS"], ["exa", "EXA"], ["bnk", "BNK"]] as const;

/** One round's table for the pool: who scored what in that round alone. */
export function RoundTable({ rows }: { rows: LeaderRow[] }) {
  const { pool, season, matches, me } = useLeague();
  const [scored, setScored] = useState<Scored[]>(() => readCache<Scored[]>(`roundtable2:${pool!.id}`) ?? []);
  const entries = rows.filter((r) => r.entry_id !== null);
  const ids = entries.map((r) => r.entry_id!).join(",");
  // Rounds with at least one result in, newest last.
  const played = useMemo(() => [...new Set(matches.filter((m) => m.home_score !== null).map((m) => m.round))].sort((a, b) => a - b), [matches]);
  const [round, setRound] = useState<number | null>(null);
  const shown = round ?? played[played.length - 1] ?? null;

  useEffect(() => {
    if (!ids) return;
    supabase.from("prediction_scores").select("entry_id, round, total_pts, result_pts, margin_pts, near_pts, exact_pts")
      .eq("season", season.id).in("entry_id", ids.split(",").map(Number))
      .then(({ data }) => { const r = (data ?? []) as Scored[]; writeCache(`roundtable2:${pool!.id}`, r); setScored(r); });
  }, [ids, season.id, pool]);

  if (shown === null) return <p className="muted">No results in yet. Round tables appear once the first match is played.</p>;
  const inRound = scored.filter((s) => s.round === shown);
  const table = entries.map((r) => {
    const mine = inRound.filter((s) => s.entry_id === r.entry_id);
    const sum = (f: (s: Scored) => number) => mine.reduce((a, s) => a + f(s), 0);
    const parts = {
      res: sum((s) => s.result_pts), mar: sum((s) => s.margin_pts), cls: sum((s) => s.near_pts), exa: sum((s) => s.exact_pts),
      bnk: sum((s) => s.total_pts - s.result_pts - s.margin_pts - s.near_pts - s.exact_pts),
    };
    return {
      parts,
      user_id: r.user_id, manager: r.manager, team: r.team_name,
      pts: mine.reduce((a, s) => a + s.total_pts, 0),
      right: mine.filter((s) => s.result_pts > 0).length,
      exact: mine.filter((s) => s.exact_pts > 0).length,
      called: mine.length,
    };
  }).sort((a, b) => b.pts - a.pts || b.exact - a.exact || a.manager.localeCompare(b.manager));
  const inPlay = matches.filter((m) => m.round === shown);
  const done = inPlay.filter((m) => m.home_score !== null).length;

  return (
    <>
      <RoundPicker rounds={played} round={shown} onPick={setRound} matches={matches} />
      <p className="small muted" style={{ margin: "0 0 10px" }}>
        {done === inPlay.length ? `All ${done} matches played.` : `${done} of ${inPlay.length} matches played so far.`}
      </p>
      <ol className="board">
        {table.map((r) => (
          <li key={r.user_id} className={r.user_id === me.user_id ? "me" : ""}>
            <div className="brow">
              <span className="rank">{1 + table.filter((x) => x.pts > r.pts).length}</span>
              <div className="who">
                <strong>{r.team ?? r.manager}</strong>
                <span className="small muted">{r.manager} · {r.called ? `${r.called} match${r.called === 1 ? "" : "es"} · ${r.right} right result${r.right === 1 ? "" : "s"} · ${r.exact} exact` : "No calls scored"}</span>
              </div>
              <span className="btotal">{r.pts}</span>
            </div>
            {r.called > 0 && (
              <div className="bparts">
                {PARTS.map(([k, code]) => (
                  <span key={code} className={r.parts[k] > 0 ? "pchip on" : "pchip"}>{code} {r.parts[k]}</span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}
