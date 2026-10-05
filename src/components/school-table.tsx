"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ListCrest, useCrests } from "@/components/crest";
import { useLeague } from "@/components/league";
import { schoolHref } from "@/lib/crest";
import { readCache, writeCache } from "@/lib/cache";
import { supabase } from "@/lib/supabase";

type Stage = "high" | "primary";
interface SchoolRow {
  emis: string; name: string; town: string | null; members: number; confirmed: number;
  score: number | null; rounds_counted: number; best_turnout: number; mine: boolean;
}
const TEAM = 20;
const MINIMUM = 10;

/**
 * Schools against each other for this tournament. Each round a school scores
 * the average of its best 20 confirmed players who played, once at least 10
 * did; the season score adds the rounds up.
 */
export function SchoolTable() {
  const { season } = useLeague();
  const crests = useCrests();
  const [stage, setStage] = useState<Stage>("high");
  const key = `schools3:${season.id}:${stage}`;
  const [rows, setRows] = useState<SchoolRow[] | null>(() => readCache<SchoolRow[]>(key) ?? null);

  useEffect(() => {
    setRows(readCache<SchoolRow[]>(key) ?? null);
    supabase.rpc("school_table", { p_season: season.id, p_stage: stage })
      .then(({ data }) => { const r = (data ?? []) as SchoolRow[]; writeCache(key, r); setRows(r); });
  }, [key, season.id, stage]);

  const ranked = (rows ?? []).filter((r) => r.score !== null)
    .sort((a, b) => Number(b.score) - Number(a.score) || b.rounds_counted - a.rounds_counted || a.name.localeCompare(b.name));
  const waiting = (rows ?? []).filter((r) => r.score === null)
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
                    <span className="rank">{1 + ranked.filter((x) => Number(x.score) > Number(r.score)).length}</span>
                    <ListCrest emis={r.emis} crests={crests} size={30} />
                    <div className="who">
                      <Link href={schoolHref(r.emis)} className="sch-link"><strong>{r.name}</strong></Link>
                      <span className="small muted">{[r.town, `${r.confirmed} confirmed`, `${r.rounds_counted} ${r.rounds_counted === 1 ? "round" : "rounds"}`].filter(Boolean).join(" · ")}</span>
                    </div>
                    <span className="btotal">{Number(r.score).toFixed(1)}</span>
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
                    <div className="brow">
                    <ListCrest emis={r.emis} crests={crests} size={30} />
                    <div className="who">
                      <Link href={schoolHref(r.emis)} className="sch-link"><strong>{r.name}</strong></Link>
                      <span className="small muted">
                        {r.confirmed < MINIMUM
                          ? `${r.confirmed} of ${MINIMUM} confirmed players needed · ${r.members} in the league`
                          : `${r.confirmed} confirmed · needs ${MINIMUM} to play in the same round`}
                      </span>
                    </div>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}
      <p className="small muted" style={{ marginTop: 12 }}>
        Every round, a school scores the average of its best {TEAM} confirmed players who played that round. At least{" "}
        {MINIMUM} confirmed players have to play for the round to count; otherwise the school scores 0 for it. The table adds
        the rounds up, so a school that turns up every week climbs. Players are confirmed when two schoolmates vouch for
        them on their profiles.
      </p>
      <p className="small" style={{ marginTop: 8 }}><Link href="/giving/">See what sponsors have given each school</Link></p>
    </>
  );
}
