"use client";

import { useEffect, useState } from "react";
import { kickoff, roundName } from "@/lib/format";
import { logEvent } from "@/lib/events";
import { nameList, stillToCall, type OrganiserRow } from "@/lib/growth";
import { supabase } from "@/lib/supabase";

/**
 * Under a league you started: who has called the next round, and a
 * WhatsApp nudge for the rest. Counts only; nobody's scores.
 */
export function OrganiserLine({ poolId, poolName, me, site }: { poolId: number; poolName: string; me: string; site: string }) {
  const [rows, setRows] = useState<OrganiserRow[] | null>(null);
  useEffect(() => {
    supabase.rpc("organiser_round", { p_pool: poolId }).then(({ data }) => setRows((data ?? []) as OrganiserRow[]));
  }, [poolId]);

  if (!rows || rows.length < 2) return null;
  const { round, first_ko } = rows[0];
  const others = rows.filter((r) => r.user_id !== me);
  const missing = stillToCall(rows, me);
  const done = others.length - missing.length;
  const text = `${roundName(round)} starts ${kickoff(first_ko)}. ${missing.length === 1 ? `${missing[0].display_name}, your` : "Your"} calls for "${poolName}" aren't all in yet, get them in before kickoff: ${site}/predict/`;

  return (
    <div className="lgc-organiser small">
      <span className="muted">
        {missing.length === 0
          ? `Everyone has called ${roundName(round).toLowerCase()}.`
          : `${done} of ${others.length} have called ${roundName(round).toLowerCase()}. Still to call: ${nameList(missing.map((m) => m.display_name))}.`}
      </span>
      {missing.length > 0 && (
        <a className="linkish" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"
          onClick={() => logEvent("organiser_nudged", { round, missing: missing.length }, poolId)}>Nudge on WhatsApp</a>
      )}
    </div>
  );
}
