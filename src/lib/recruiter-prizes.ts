import { useCallback, useEffect, useState } from "react";
import { readCache, writeCache } from "@/lib/cache";
import { supabase } from "@/lib/supabase";

export { monthName, names, offerMonths } from "@/lib/recruiter-months";

export type RecruiterStatus = "upcoming" | "open" | "counting" | "no winner" | "awaiting" | "delivered" | "not delivered";

/** A business's prize for a pool's top recruiter of the month, with where it stands. */
export interface RecruiterPrize {
  /** The month, as the first day (YYYY-MM-01). */
  month: string; sponsor: string; prize: string; details: string | null; image_path: string | null; offered_by: string;
  status: RecruiterStatus;
  /** The most new players anyone here brought in that month, and who has that many. */
  best: number; leaders: string[] | null;
  winners: string[] | null; received: string[];
  decided_at: string; due_at: string;
  sponsor_about: string | null; sponsor_website: string | null; sponsor_logo: string | null;
}

/** A pool's recruiter prizes, last visit's copy first. */
export function usePoolRecruiterPrizes(poolId: number | null | undefined): [RecruiterPrize[], () => void] {
  const key = `rprizes:${poolId}`;
  const [rows, setRows] = useState<RecruiterPrize[]>(() => (poolId ? readCache<RecruiterPrize[]>(key) ?? [] : []));
  const load = useCallback(() => {
    if (!poolId) { setRows([]); return; }
    supabase.rpc("pool_recruiter_prizes", { p_pool: poolId })
      .then(({ data }) => { const r = (data ?? []) as RecruiterPrize[]; writeCache(key, r); setRows(r); });
  }, [poolId, key]);
  useEffect(() => { setRows(poolId ? readCache<RecruiterPrize[]>(key) ?? [] : []); load(); }, [poolId, key, load]);
  return [rows, load];
}
