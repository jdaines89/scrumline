"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Season } from "@/lib/types";

const KEY = "sponsor-season";

function remembered(value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(KEY, value);
    return localStorage.getItem(KEY);
  } catch { return null; }
}

/**
 * The tournaments a business can back and the one it's looking at. Works for
 * players and for business accounts alike, so the sponsor pages don't need
 * the league (which a business account never loads).
 */
export function useSponsorSeason() {
  const [seasons, setSeasons] = useState<Season[] | null>(null);
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    supabase.from("seasons").select("*").eq("is_replay", false)
      .order("starts_on", { ascending: false, nullsFirst: false })
      .then(({ data }) => {
        const ss = (data ?? []) as Season[];
        setSeasons(ss);
        const saved = remembered();
        setId(ss.some((s) => s.id === saved) ? saved : ss[0]?.id ?? null);
      });
  }, []);
  return {
    seasons: seasons ?? [],
    season: seasons?.find((s) => s.id === id) ?? null,
    loading: seasons === null,
    setSeason: (v: string) => { remembered(v); setId(v); },
  };
}
