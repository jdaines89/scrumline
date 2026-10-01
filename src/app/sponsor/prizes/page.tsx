"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLeague } from "@/components/league";
import { poolLabel } from "@/components/pool-name";
import { PrizeSetup } from "@/components/prize-setup";
import { RecruiterPrizeSetup } from "@/components/recruiter-prize";
import { supabase } from "@/lib/supabase";

/**
 * Prizes a business puts up in the pools its owner plays in: a round prize
 * for the round's top caller, and a recruiter prize for the month's top
 * recruiter. Kept here, with the rest of the business pages, so players who
 * don't run a business never see these forms.
 */
export default function PrizesPage() {
  const { seasons, season, setSeason, pools, pool, setPool } = useLeague();
  const [hasBusiness, setHasBusiness] = useState<boolean | null>(null);
  useEffect(() => {
    supabase.rpc("my_businesses").then(({ data }) => setHasBusiness(((data ?? []) as unknown[]).length > 0));
  }, []);

  if (hasBusiness === false) return (
    <div className="card narrow">
      <h2>Prizes</h2>
      <p className="sub">Prizes come from a business, so everyone knows who&apos;s behind them. <Link href="/sponsor/profile/">Set up your business profile</Link> and come back here.</p>
    </div>
  );

  return (
    <>
      <div className="card">
        <h2>Prizes</h2>
        <p className="sub">Put up a prize from your business in a pool you play in: for the round&apos;s top caller, or for whoever brings in the most new players this month. Every player in the pool sees it, with your logo.</p>
        <div className="switcher prize-pick">
          {seasons.length > 1 && <label>
            <span>Tournament</span>
            <select value={season.id} onChange={(e) => setSeason(e.target.value)}>
              {seasons.filter((s) => !s.is_replay).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>}
          <label>
            <span>Pool</span>
            {pools.length ? (
              <select value={pool?.id ?? ""} onChange={(e) => setPool(Number(e.target.value))}>
                {pools.map((p) => <option key={p.id} value={p.id}>{poolLabel(p)}</option>)}
              </select>
            ) : <Link href="/pools/" className="nopool">Join a pool first</Link>}
          </label>
        </div>
        {pool?.school_emis && <p className="small muted" style={{ margin: "10px 0 0" }}>School pools take recruiter prizes only. Round prizes are for mates&apos; pools of up to 50.</p>}
      </div>
      <PrizeSetup />
      <RecruiterPrizeSetup />
    </>
  );
}
