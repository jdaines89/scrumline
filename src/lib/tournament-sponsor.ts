"use client";

import { useEffect, useState } from "react";
import { readCache, writeCache } from "@/lib/cache";
import { supabase } from "@/lib/supabase";

/** A tournament's live sponsor: the whole tournament (round null) or one round of it. */
export interface SeasonSponsor {
  id: number; round: number | null; display_name: string; logo_path: string | null;
  offer: string | null; link: string | null; about: string | null; website: string | null;
}

/** Everyone backing this tournament, for every pool in it. */
export function useSeasonSponsors(season: string | undefined): SeasonSponsor[] {
  const [all, setAll] = useState<SeasonSponsor[]>(() => (season ? readCache<SeasonSponsor[]>(`tsponsor:${season}`) ?? [] : []));
  useEffect(() => {
    if (!season) { setAll([]); return; }
    setAll(readCache<SeasonSponsor[]>(`tsponsor:${season}`) ?? []);
    supabase.rpc("season_sponsors", { p_season: season }).then(({ data }) => {
      const s = (data ?? []) as SeasonSponsor[];
      writeCache(`tsponsor:${season}`, s); setAll(s);
    });
  }, [season]);
  return all;
}

export function tournamentEvent(id: number, kind: "seen" | "tap") {
  if (kind === "seen") {
    const key = `sl:tseen:${id}:${new Date().toISOString().slice(0, 10)}`;
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, "1"); } catch { /* the database still dedupes */ }
  }
  supabase.rpc("tournament_sponsor_event", { p_id: id, p_kind: kind }).then(() => undefined);
}
