"use client";

import { useEffect, useState } from "react";
import { useLeague } from "@/components/league";
import { readCache, writeCache } from "@/lib/cache";
import { supabase } from "@/lib/supabase";

type Stage = "high" | "primary";
interface SchoolRow { emis: string; name: string; town: string | null; members: number; confirmed: number; seats: number; points: number | null; average: number | null; mine: boolean }
const RANKED_AT = 3;

/**
 * Schools against each other for this tournament: the average points of each
 * school's confirmed players, so a small school can beat a big one.
 */
export function SchoolTable() {
  const { season } = useLeague();
  const [stage, setStage] = useState<Stage>("high");
  const key = `schools2:${season.id}:${stage}`;
  const [rows, setRows] = useState<SchoolRow[] | null>(() => readCache<SchoolRow[]>(key) ?? null);

  useEffect(() => {
    setRows(readCache<SchoolRow[]>(key) ?? null);
    supabase.rpc("school_table", { p_season: season.id, p_stage: stage })
      .then(({ data }) => { const r = (data ?? []) as SchoolRow[]; writeCache(key, r); setRows(r); });
  }, [key, season.id, stage]);

  const ranked = (rows ?? []).filter((r) => r.average !== null)
    .sort((a, b) => Number(b.average) - Number(a.average) || b.confirmed - a.confirmed || a.name.localeCompare(b.name));
  const waiting = (rows ?? []).filter((r) => r.average === null)
    .sort((a, b) => b.confirmed - a.confirmed || b.members - a.members || a.name.localeCompare(b.name));

  return (
    <>
      <div className="seg sm" role="tablist" aria-label="School stage">
        {(["high", "primary"] as const).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={stage === s} className={stage === s ? "on" : ""} onClick={() => setStage(s)}>
            {s === "high" ? "High schools" : "Primary schools"}
          </button>
        ))}
      </div>
      {rows === null ? (
        <ol className="board" aria-busy="true" aria-label="Loading the table">
          {[0, 1].map((i) => <li key={i} className="skeleton" style={{ height: 64 }} />)}
        </ol>
      ) : rows.length === 0 ? (
        <p className="muted">No one has added a {stage} school yet. Add yours on your profile.</p>
      ) : (
        <>
          {ranked.length > 0 && (
            <ol className="board schools-table">
              {ranked.map((r) => (
                <li key={r.emis} className={r.mine ? "me" : ""}>
                  <div className="brow">
                    <span className="rank">{1 + ranked.filter((x) => Number(x.average) > Number(r.average)).length}</span>
                    <div className="who">
                      <strong>{r.name}</strong>
                      <span className="small muted">{[r.town, `${Math.min(r.confirmed, r.seats)} of ${r.seats} in the team`].filter(Boolean).join(" · ")}</span>
                    </div>
                    <span className="btotal">{Number(r.average).toFixed(1)}</span>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {waiting.length > 0 && (
            <>
              {ranked.length > 0 && <p className="small muted school-waiting">Not ranked yet</p>}
              <ol className="board schools-table waiting">
                {waiting.map((r) => (
                  <li key={r.emis} className={r.mine ? "me" : ""}>
                    <div className="who">
                      <strong>{r.name}</strong>
                      <span className="small muted">
                        {r.confirmed} of {RANKED_AT} confirmed players · {r.members} in the league
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}
      <p className="small muted" style={{ marginTop: 12 }}>
        Each school fields a team sized to the school: one player per 100 learners, from 3 to 15. The score is the
        average of its best confirmed players across the whole team, and an empty seat counts as 0, so a small school
        can beat a big one but three sharp callers can't carry a big school. A school is ranked once {RANKED_AT} of its
        players have been confirmed by schoolmates on their profiles.
      </p>
    </>
  );
}
