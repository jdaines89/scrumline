"use client";

import { useState } from "react";
import { useLeague } from "@/components/league";
import { roundName } from "@/lib/format";
import { countsFrom } from "@/lib/rounds";
import { supabase } from "@/lib/supabase";

/** "Every round", then each round of the tournament, for picking where a league's points start. */
export function RoundOptions({ rounds }: { rounds: number[] }) {
  return (
    <>
      <option value="">Every round</option>
      {rounds.map((r) => <option key={r} value={r}>{roundName(r)} onwards</option>)}
    </>
  );
}

/**
 * Under a mates' league's name: where its points start counting, when not from
 * the first round. Whoever started the league can change it here.
 */
export function CountsFrom() {
  const { pool, me, rounds, reloadPools } = useLeague();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!pool || pool.school_emis) return null;
  const from = countsFrom(pool);
  const mine = pool.created_by === me.user_id;
  if (!from && !mine) return null;

  async function pick(value: string) {
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("set_league_start", { p_pool: pool!.id, p_round: value ? Number(value) : null });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    setEditing(false);
    await reloadPools();
  }

  return (
    <div className="counts-from small">
      {editing ? (
        <label>
          <span className="muted">Points count from</span>
          <select autoFocus disabled={busy} value={from || ""} onChange={(e) => pick(e.target.value)} onBlur={() => !busy && setEditing(false)}>
            <RoundOptions rounds={rounds} />
          </select>
        </label>
      ) : (
        <span className="muted">
          {from ? `Points count from ${roundName(from)}. Earlier rounds still count in your other leagues.` : "Points count from every round."}
          {mine && <> <button type="button" className="linkish small" onClick={() => setEditing(true)}>Change</button></>}
        </span>
      )}
      {msg && <div className="notice" style={{ marginTop: 8 }}>{msg}</div>}
    </div>
  );
}
