"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Match, Pool, Season } from "@/lib/types";

/** The first round a league counts; 0 when it counts every round. */
export const countsFrom = (pool: Pool | null | undefined) => pool?.counts_from_round ?? 0;

/** Which rounds this entry has locked, and the round to open on. */
export function useRoundLocks(entryId: number | undefined, season: Season, matches: Match[]) {
  const [locked, setLocked] = useState<Set<number>>(new Set());
  const reload = useCallback(async () => {
    if (!entryId) return;
    const { data } = await supabase.from("round_locks").select("round").eq("entry_id", entryId);
    setLocked(new Set((data ?? []).map((r: { round: number }) => r.round)));
  }, [entryId]);
  useEffect(() => { reload(); }, [reload]);

  const now = Date.now();
  // A replay round locks when the member locks it in; a live one is done once
  // every match in it has kicked off (each match locks at its own kickoff).
  const isLocked = (round: number) => season.is_replay
    ? locked.has(round)
    : matches.filter((m) => m.round === round).every((m) => new Date(m.kickoff_at).getTime() <= now);
  const matchStarted = (m: Match) => !season.is_replay && new Date(m.kickoff_at).getTime() <= now;

  return { locked, isLocked, matchStarted, reload };
}

export async function lockRound(entryId: number, season: string, round: number) {
  return supabase.from("round_locks").insert({ entry_id: entryId, season, round });
}

export function firstOpenRound(rounds: number[], isLocked: (r: number) => boolean): number {
  return rounds.find((r) => !isLocked(r)) ?? rounds[rounds.length - 1] ?? 1;
}
