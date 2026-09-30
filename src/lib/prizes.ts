import { useCallback, useEffect, useState } from "react";
import { readCache, writeCache } from "@/lib/cache";
import { supabase } from "@/lib/supabase";

export type PrizeStatus = "upcoming" | "in play" | "no winner" | "awaiting" | "delivered" | "not delivered";

/** A round prize a member's business put up, with how it turned out. */
export interface PoolPrize {
  round: number; sponsor: string; prize: string; offered_by: string; status: PrizeStatus;
  winners: string[] | null; received: string[]; due_at: string | null; image_path: string | null;
  details: string | null; sponsor_about: string | null; sponsor_website: string | null; sponsor_logo: string | null;
  /** Until when the business can still change it: 48 hours before the round's first kickoff. */
  edit_until: string | null;
}

/** A prize photo's address: they sit in a public bucket, like business logos. */
export function prizePhotoUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}/storage/v1/object/public/prize-photos/${path}`;
}

/** A pool's prizes, last visit's copy first. */
export function usePoolPrizes(poolId: number | null | undefined): [PoolPrize[], () => void] {
  const key = `prizes:${poolId}`;
  const [prizes, setPrizes] = useState<PoolPrize[]>(() => (poolId ? readCache<PoolPrize[]>(key) ?? [] : []));
  const load = useCallback(() => {
    if (!poolId) { setPrizes([]); return; }
    supabase.rpc("pool_prizes", { p_pool: poolId })
      .then(({ data }) => { const r = (data ?? []) as PoolPrize[]; writeCache(key, r); setPrizes(r); });
  }, [poolId, key]);
  useEffect(() => { setPrizes(poolId ? readCache<PoolPrize[]>(key) ?? [] : []); load(); }, [poolId, key, load]);
  return [prizes, load];
}

/** "3 of 3 delivered", counting only prizes whose round has a winner. */
export function trackRecord(prizes: PoolPrize[]): { decided: number; delivered: number; missed: number } {
  const decided = prizes.filter((p) => p.status === "delivered" || p.status === "not delivered");
  return {
    decided: decided.length,
    delivered: decided.filter((p) => p.status === "delivered").length,
    missed: decided.filter((p) => p.status === "not delivered").length,
  };
}

export function whoWon(p: PoolPrize, nameOf: (id: string) => string): string {
  return (p.winners ?? []).map(nameOf).join(" & ");
}
