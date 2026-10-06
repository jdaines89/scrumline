"use client";

import { Fragment, useEffect, useState } from "react";
import { useLeague } from "@/components/league";
import { signed, roundShort } from "@/lib/format";
import { countsFrom } from "@/lib/rounds";
import { supabase } from "@/lib/supabase";

interface Scored {
  entry_id: number; round: number; match_id: string; total_pts: number; is_banker: boolean;
  pred_home: number; pred_away: number; real_home: number; real_away: number;
}

/**
 * You against one mate, round by round: points each, the round's swing and
 * the running gap, so you can see where it got away. Tap a round for the
 * matches in it, both calls side by side. Only scored (so locked) calls are
 * readable, which is all this needs.
 */
export function HeadToHead({ mine, theirs, name }: { mine: number | null; theirs: number; name: string }) {
  const { matches, teams, pool } = useLeague();
  const [loaded, setRows] = useState<Scored[] | null>(null);
  // Only the rounds this league counts.
  const from = countsFrom(pool);
  const rows = loaded && loaded.filter((r) => r.round >= from);
  const [open, setOpen] = useState<number | null>(null);
  const solo = mine === null || mine === theirs;

  useEffect(() => {
    const ids = solo ? [theirs] : [mine!, theirs];
    supabase.from("prediction_scores")
      .select("entry_id, round, match_id, total_pts, is_banker, pred_home, pred_away, real_home, real_away")
      .in("entry_id", ids)
      .then(({ data }) => setRows((data ?? []) as Scored[]));
  }, [mine, theirs, solo]);

  if (!rows) return <p className="small muted h2h">Loading&hellip;</p>;
  const rounds = [...new Set(rows.map((r) => r.round))].sort((a, b) => a - b);
  if (!rounds.length) return <p className="small muted h2h">Nothing scored yet.</p>;

  const sum = (entry: number, round: number) =>
    rows.filter((r) => r.entry_id === entry && r.round === round).reduce((a, r) => a + r.total_pts, 0);
  let gap = 0;
  const call = (entry: number | null, match: string) => rows.find((r) => r.entry_id === entry && r.match_id === match);
  const short = (id: string) => teams.get(id)?.short_name ?? "?";

  return (
    <div className="h2h" onClick={(e) => e.stopPropagation()}>
      <table>
        <thead><tr>
          <th>Round</th>
          {!solo && <th className="num">You</th>}
          <th className="num">{solo ? "Points" : name}</th>
          {!solo && <th className="num">Swing</th>}
          {!solo && <th className="num">Gap</th>}
        </tr></thead>
        <tbody>
          {rounds.map((rd) => {
            const me = solo ? 0 : sum(mine!, rd), them = sum(theirs, rd);
            gap += me - them;
            const ms = matches.filter((m) => m.round === rd && rows.some((r) => r.match_id === m.id));
            return (
              <Fragment key={rd}>
                <tr className="rrow" onClick={() => setOpen(open === rd ? null : rd)}>
                  <td>{open === rd ? "▾" : "▸"} {roundShort(rd)}</td>
                  {!solo && <td className="num">{me}</td>}
                  <td className="num">{them}</td>
                  {!solo && <td className={`num ${me > them ? "up" : me < them ? "down" : ""}`}>{signed(me - them)}</td>}
                  {!solo && <td className={`num ${gap > 0 ? "up" : gap < 0 ? "down" : ""}`}><strong>{signed(gap)}</strong></td>}
                </tr>
                {open === rd && ms.map((m) => {
                  const a = call(mine, m.id), b = call(theirs, m.id);
                  const real = a ?? b;
                  return (
                    <tr key={m.id} className="mrow">
                      <td>
                        {short(m.home_team_id)} v {short(m.away_team_id)}
                        <div className="muted">{real ? `${real.real_home}–${real.real_away}` : ""}</div>
                      </td>
                      {!solo && <td className="num">{a ? <>{a.pred_home}–{a.pred_away}{a.is_banker && " ×2"}<div className="pts">+{a.total_pts}</div></> : <span className="muted">no call</span>}</td>}
                      <td className="num">{b ? <>{b.pred_home}–{b.pred_away}{b.is_banker && " ×2"}<div className="pts">+{b.total_pts}</div></> : <span className="muted">no call</span>}</td>
                      {!solo && (() => {
                        const d = (a?.total_pts ?? 0) - (b?.total_pts ?? 0);
                        return <td className={`num ${d > 0 ? "up" : d < 0 ? "down" : "muted"}`}>{signed(d)}</td>;
                      })()}
                      {!solo && <td />}
                    </tr>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {!solo && <p className="small muted">Swing is the difference in points, per round and per game, and Gap is the running total. Green means you&apos;re ahead.</p>}
    </div>
  );
}
