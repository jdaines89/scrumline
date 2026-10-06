"use client";

import { useEffect, useState } from "react";
import { Crest } from "@/components/team";
import { dayHeading, kickTime, roundName } from "@/lib/format";
import { readPendingCalls, writePendingCalls } from "@/lib/pending-calls";
import { isRugbyScore, scoreInput } from "@/lib/rugby";
import { supabase } from "@/lib/supabase";
import type { Team } from "@/lib/types";

type Row = {
  season_id: string; season_name: string; round: number; match_id: string; kickoff_at: string; venue: string | null;
  home_id: string; home_name: string; home_short: string; home_colour: string | null; home_ink: string | null; home_badge: string | null;
  away_id: string; away_name: string; away_short: string; away_colour: string | null; away_ink: string | null; away_badge: string | null;
};
const team = (r: Row, side: "home" | "away"): Team => ({
  id: r[`${side}_id`], display_name: r[`${side}_name`], short_name: r[`${side}_short`], stadium: null,
  colour: r[`${side}_colour`], colour_ink: r[`${side}_ink`], badge_url: r[`${side}_badge`],
});

/**
 * The next round's games on an invite link, to call before signing up. Boxes
 * start empty; what's typed waits on this device and is saved to the team the
 * newcomer gets once they're in.
 */
export function InviteCalls({ league, onCount }: { league: string; onCount: (n: number) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [draft, setDraft] = useState<Record<string, [string, string]>>({});
  const [open, setOpen] = useState(false);

  useEffect(() => {
    supabase.rpc("invite_round", { p_code: league || null }).then(({ data }) => {
      const rs = (data ?? []) as Row[];
      setRows(rs);
      const p = readPendingCalls();
      if (p && rs.length && p.season === rs[0].season_id) {
        setDraft(Object.fromEntries(Object.entries(p.calls).map(([id, [h, a]]) => [id, [String(h), String(a)]])));
        if (Object.keys(p.calls).length) setOpen(true);
      }
    });
  }, [league]);

  const called = rows ? rows.filter((r) => { const d = draft[r.match_id]; return d && d[0] !== "" && d[1] !== "" && isRugbyScore(+d[0]) && isRugbyScore(+d[1]); }) : [];
  useEffect(() => { onCount(called.length); }, [called.length, onCount]);

  if (!rows || !rows.length) return null;
  if (!open) {
    return (
      <div className="icalls">
        <button type="button" className="ghost icalls-open" onClick={() => setOpen(true)} aria-expanded={false}>
          See {roundName(rows[0].round)}&apos;s {rows.length} games
        </button>
        <p className="small muted icalls-sub">No need to call anything yet. You can, and it saves when you join.</p>
      </div>
    );
  }

  function set(id: string, h: string, a: string) {
    const next = { ...draft, [id]: [scoreInput(h), scoreInput(a)] as [string, string] };
    setDraft(next);
    const calls: Record<string, [number, number]> = {};
    const kickoffs: Record<string, string> = {};
    for (const r of rows!) {
      const d = next[r.match_id];
      if (d && d[0] !== "" && d[1] !== "" && isRugbyScore(+d[0]) && isRugbyScore(+d[1])) { calls[r.match_id] = [+d[0], +d[1]]; kickoffs[r.match_id] = r.kickoff_at; }
    }
    writePendingCalls({ season: rows![0].season_id, calls, kickoffs });
  }
  const bad = (v: string) => v !== "" && !isRugbyScore(+v);

  return (
    <div className="icalls">
      <div className="icalls-head">
        <h3>{roundName(rows[0].round)}</h3>
        <span className="muted small">{called.length} of {rows.length} called</span>
      </div>
      <p className="small muted icalls-sub">Calling is optional. Anything you call is saved to your team when you join.</p>
      {rows.map((r, i) => {
        const d = draft[r.match_id] ?? ["", ""];
        const h = team(r, "home"), a = team(r, "away");
        return (
          <div key={r.match_id}>
            {(i === 0 || dayHeading(r.kickoff_at) !== dayHeading(rows[i - 1].kickoff_at)) && <div className="fx-day">{dayHeading(r.kickoff_at)}</div>}
            <div className="icall">
              <span className="icall-team"><Crest team={h} size={26} /><span>{h.display_name}</span></span>
              <span className="icall-boxes">
                <input className={`pbox${bad(d[0]) ? " bad" : ""}`} inputMode="numeric" pattern="[0-9]*" maxLength={2} value={d[0]}
                  aria-label={`${h.display_name} score`} onChange={(e) => set(r.match_id, e.target.value, d[1])} />
                <input className={`pbox${bad(d[1]) ? " bad" : ""}`} inputMode="numeric" pattern="[0-9]*" maxLength={2} value={d[1]}
                  aria-label={`${a.display_name} score`} onChange={(e) => set(r.match_id, d[0], e.target.value)} />
              </span>
              <span className="icall-team away"><Crest team={a} size={26} /><span>{a.display_name}</span></span>
            </div>
            <div className="icall-when muted">{kickTime(r.kickoff_at)}</div>
            {(bad(d[0]) || bad(d[1])) && <p className="scorewarn icall-warn">A rugby side can&apos;t score 1, 2 or 4.</p>}
          </div>
        );
      })}
    </div>
  );
}
