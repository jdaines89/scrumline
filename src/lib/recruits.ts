import { useEffect, useState } from "react";
import { readCache, writeCache } from "@/lib/cache";
import { supabase } from "@/lib/supabase";

export interface Recruit { user_id: string; brought_in: number; this_month: number }

/** Who in this pool brought people in, counting only those who went on to play. */
export function usePoolRecruits(poolId: number): Recruit[] {
  const key = `recruits:${poolId}`;
  const [rows, setRows] = useState<Recruit[]>(() => readCache<Recruit[]>(key) ?? []);
  useEffect(() => {
    setRows(readCache<Recruit[]>(key) ?? []);
    supabase.rpc("pool_recruits", { p_pool: poolId }).then(({ data }) => {
      const r = (data ?? []) as Recruit[];
      writeCache(key, r);
      setRows(r);
    });
  }, [key, poolId]);
  return rows;
}

/** This month's top recruiters (ties share it), or none if nobody brought anyone in yet. */
export function topRecruiters(rows: Recruit[]): { ids: string[]; count: number } | null {
  const best = Math.max(0, ...rows.map((r) => r.this_month));
  if (best === 0) return null;
  return { ids: rows.filter((r) => r.this_month === best).map((r) => r.user_id), count: best };
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
