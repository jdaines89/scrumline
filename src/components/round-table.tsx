"use client";

import { useEffect, useMemo, useState } from "react";
import { useLeague } from "@/components/league";
import { RoundPicker } from "@/components/round-picker";
import { readCache, writeCache } from "@/lib/cache";
import { supabase } from "@/lib/supabase";
import type { LeaderRow } from "@/lib/types";
import { roundName } from "@/lib/format";
import { countsFrom } from "@/lib/rounds";

interface Scored {
  entry_id: number; round: number; match_id: string; is_banker: boolean; total_pts: number; result_pts: number; margin_pts: number; near_pts: number; exact_pts: number;
  pred_home: number; pred_away: number; real_home: number; real_away: number;
}

const PARTS = [["res", "RES"], ["mar", "MAR"], ["cls", "CLS"], ["exa", "EXA"], ["bnk", "BNK"]] as const;

/** One round's table for the pool: who scored what in that round alone. */
export function RoundTable({ rows }: { rows: LeaderRow[] }) {
  const { pool, season, matches, me, teams } = useLeague();
  const [picked, setPicked] = useState<string | null>(null);
  const [scored, setScored] = useState<Scored[]>(() => readCache<Scored[]>(`roundtable3:${pool!.id}`) ?? []);
  const entries = rows.filter((r) => r.entry_id !== null);
  const ids = entries.map((r) => r.entry_id!).join(",");
  // Rounds with at least one result in, newest last.
  const from = countsFrom(pool);
  const played = useMemo(() => [...new Set(matches.filter((m) => m.home_score !== null && m.round >= from).map((m) => m.round))].sort((a, b) => a - b), [matches, from]);
  const [round, setRound] = useState<number | null>(null);
  const shown = round ?? played[played.length - 1] ?? null;

  useEffect(() => {
    if (!ids) return;
    supabase.from("prediction_scores").select("entry_id, round, match_id, is_banker, total_pts, result_pts, margin_pts, near_pts, exact_pts, pred_home, pred_away, real_home, real_away")
      .eq("season", season.id).in("entry_id", ids.split(",").map(Number))
      .then(({ data }) => { const r = (data ?? []) as Scored[]; writeCache(`roundtable3:${pool!.id}`, r); setScored(r); });
  }, [ids, season.id, pool]);

  if (shown === null) return <p className="muted">{from ? `This league counts from ${roundName(from)}. Round tables appear once its first match is played.` : "No results in yet. Round tables appear once the first match is played."}</p>;
  const inRound = scored.filter((s) => s.round === shown);
  const table = entries.map((r) => {
    const mine = inRound.filter((s) => s.entry_id === r.entry_id);
    const sum = (f: (s: Scored) => number) => mine.reduce((a, s) => a + f(s), 0);
    const parts = {
      res: sum((s) => s.result_pts), mar: sum((s) => s.margin_pts), cls: sum((s) => s.near_pts), exa: sum((s) => s.exact_pts),
      bnk: sum((s) => s.total_pts - s.result_pts - s.margin_pts - s.near_pts - s.exact_pts),
    };
    return {
      parts, calls: mine,
      user_id: r.user_id, manager: r.manager, team: r.team_name,
      pts: mine.reduce((a, s) => a + s.total_pts, 0),
      right: mine.filter((s) => s.result_pts > 0).length,
      exact: mine.filter((s) => s.exact_pts > 0).length,
      called: mine.length,
    };
  }).sort((a, b) => b.pts - a.pts || b.exact - a.exact || a.manager.localeCompare(b.manager));
  const inPlay = matches.filter((m) => m.round === shown);
  const short = (id: string) => teams.get(id)?.short_name ?? "?";
  const done = inPlay.filter((m) => m.home_score !== null).length;

  return (
    <>
      <RoundPicker rounds={played} round={shown} onPick={setRound} matches={matches} />
      <p className="small muted" style={{ margin: "0 0 10px" }}>
        {done === inPlay.length ? `All ${done} matches played.` : `${done} of ${inPlay.length} matches played so far.`} Tap a team for their calls.
      </p>
      <ol className="board">
        {table.map((r) => (
          <li key={r.user_id} className={`${r.user_id === me.user_id ? "me" : ""}${picked === r.user_id ? " open" : ""}`}
            onClick={() => r.called && setPicked(picked === r.user_id ? null : r.user_id)}>
            <div className="brow">
              <span className="rank">{1 + table.filter((x) => x.pts > r.pts).length}</span>
              <div className="who">
                <strong>{r.team ?? r.manager}</strong>
                <span className="small muted bname">{r.called ? `${r.manager} · ${r.right} of ${r.called} right` : `${r.manager} · no calls scored`}</span>
              </div>
              <span className="btotal">{r.pts}</span>
            </div>
            {picked === r.user_id && (
              <div className="bmore">
                <div className="bparts">
                  {PARTS.map(([k, code]) => (
                    <span key={code} className={r.parts[k] > 0 ? "pchip on" : "pchip"}>{code} {r.parts[k]}</span>
                  ))}
                </div>
                <ul className="rcalls">
                  {inPlay.filter((m) => m.home_score !== null).map((m) => {
                    const c = r.calls.find((x) => x.match_id === m.id);
                    return (
                      <li key={m.id}>
                        <span>{short(m.home_team_id)} v {short(m.away_team_id)} <span className="muted">{m.home_score}–{m.away_score}</span></span>
                        <span>{c ? <>{c.pred_home}–{c.pred_away}{c.is_banker && " ×2"} <strong className={c.total_pts > 0 ? "pts" : "muted"}>+{c.total_pts}</strong></> : <span className="muted">no call</span>}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}
