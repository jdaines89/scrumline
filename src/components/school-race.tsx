"use client";

import { useEffect, useState } from "react";
import { RaceChart, type Line } from "@/components/pool-race";
import { readCache, writeCache } from "@/lib/cache";
import { supabase } from "@/lib/supabase";

interface RaceData {
  rounds: number[];
  schools: { emis: string; name: string; mine: boolean; points: { round: number; running: number }[] }[];
}

/** The points race for the top schools of a stage, and your own school if it isn't among them. */
export function SchoolRace({ season, stage }: { season: string; stage: "high" | "primary" }) {
  const key = `schoolrace1:${season}:${stage}`;
  const [data, setData] = useState<RaceData | null>(() => readCache<RaceData>(key) ?? null);
  useEffect(() => {
    setData(readCache<RaceData>(key) ?? null);
    supabase.rpc("school_race", { p_season: season, p_stage: stage })
      .then(({ data: d, error }) => { if (error || !d) return; writeCache(key, d as RaceData); setData(d as RaceData); });
  }, [key, season, stage]);
  if (!data || data.rounds.length === 0 || data.schools.length < 2) return null;
  const lines: Line[] = data.schools.map((s) => {
    let run = 0;
    const pts = [0, ...data.rounds.map((rd) => { const hit = s.points.find((p) => p.round === rd); if (hit) run = Number(hit.running); return run; })];
    return { user_id: s.emis, name: s.name, mine: s.mine, pts };
  });
  return <RaceChart lines={lines} rounds={data.rounds} what="schools" byRank />;
}
