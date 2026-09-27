"use client";

import { useEffect, useState } from "react";
import { useLeague } from "@/components/league";
import { readCache, writeCache } from "@/lib/cache";
import { initials, sponsorEvent, type PoolSponsor } from "@/lib/sponsor";
import { supabase } from "@/lib/supabase";

/** The round being played now: the first with a match still to come, else the last. */
function currentRound(matches: { round: number; kickoff_at: string }[]): number | null {
  const soon = Date.now() - 3 * 36e5;
  const open = matches.filter((m) => new Date(m.kickoff_at).getTime() > soon).map((m) => m.round);
  return open.length ? Math.min(...open) : matches.length ? Math.max(...matches.map((m) => m.round)) : null;
}

/** This pool's sponsor right now: this round's, else the season's. */
export function usePoolSponsor(): PoolSponsor | null {
  const { pool, matches } = useLeague();
  const id = pool?.id;
  const [all, setAll] = useState<PoolSponsor[]>(() => (id ? readCache<PoolSponsor[]>(`sponsor:${id}`) ?? [] : []));
  useEffect(() => {
    if (!id) { setAll([]); return; }
    setAll(readCache<PoolSponsor[]>(`sponsor:${id}`) ?? []);
    supabase.rpc("pool_sponsors", { p_pool: id }).then(({ data }) => {
      const s = (data ?? []) as PoolSponsor[];
      writeCache(`sponsor:${id}`, s); setAll(s);
    });
  }, [id]);
  const round = currentRound(matches);
  return all.find((s) => s.round !== null && s.round === round) ?? all.find((s) => s.round === null) ?? null;
}

/** One quiet line under the pool name. Nothing at all when the pool has no sponsor. */
export function SponsorLine({ sponsor }: { sponsor: PoolSponsor | null }) {
  useEffect(() => { if (sponsor) sponsorEvent(sponsor.booking_id, "seen"); }, [sponsor]);
  if (!sponsor) return null;
  return (
    <div className="spline">
      <div className="sp-tile">{initials(sponsor.display_name)}</div>
      <div>
        <div>{sponsor.round ? `Round ${sponsor.round} sponsored by` : "Sponsored by"} <b>{sponsor.display_name}</b></div>
        {sponsor.offer && (sponsor.link
          ? <a href={sponsor.link} target="_blank" rel="noopener sponsored" onClick={() => sponsorEvent(sponsor.booking_id, "tap")}>{sponsor.offer} ›</a>
          : <div>{sponsor.offer}</div>)}
      </div>
    </div>
  );
}
