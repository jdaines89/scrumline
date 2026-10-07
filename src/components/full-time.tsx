"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readCache, writeCache } from "@/lib/cache";
import { placeLine, type FullTime } from "@/lib/moments";
import { supabase } from "@/lib/supabase";
import { ShareMomentLine, useShareMoment } from "@/components/share-moment";

/**
 * The games you called that finished in the last day and a half: the score,
 * your call and its points, then where it leaves you in your league.
 * Drawn from last visit's copy first, so Home doesn't jump.
 */
export function FullTimeCard() {
  const [ft, setFt] = useState<FullTime | null>(() => readCache<FullTime | null>("fulltime") ?? null);
  const moment = useShareMoment();
  useEffect(() => {
    supabase.rpc("my_full_time").then(({ data, error }) => {
      if (error) return;
      const r = (data ?? null) as FullTime | null;
      writeCache("fulltime", r); setFt(r);
    });
  }, []);
  if (!ft || !ft.matches?.length) return null;
  const games = ft.matches.slice(-3);
  const total = ft.matches.reduce((a, m) => a + m.pts, 0);
  return (
    <div className="card fulltime">
      <div className="ft-head">
        <span className="ft-k">Full time</span>
        <span className="ft-total">+{total} pts</span>
      </div>
      <ul className="ft-list">
        {games.map((m) => (
          <li key={m.match_id}>
            <strong className="ft-score">{m.home} {m.home_score}–{m.away_score} {m.away}</strong>
            <span className="small muted">
              You called {m.pred_home}–{m.pred_away}
              {m.banker && <span className="pchip bank2">×2</span>}
              {" · "}
              <span className={m.pts > 0 ? "ft-pts" : ""}>{m.exact ? `+${m.pts}, spot on` : m.pts > 0 ? `+${m.pts}` : "no points"}</span>
            </span>
          </li>
        ))}
      </ul>
      {ft.matches.length > games.length && <p className="small muted ft-more">And {ft.matches.length - games.length} more. <Link href="/predict/">See them all</Link></p>}
      {ft.league && <p className="ft-place">{placeLine(ft.league)}</p>}
      {moment && <ShareMomentLine moment={moment} />}
    </div>
  );
}
