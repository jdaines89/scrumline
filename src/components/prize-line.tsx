"use client";

import { useState } from "react";
import { useLeague } from "@/components/league";
import { prizePhotoUrl, type PoolPrize } from "@/lib/prizes";
import { supabase } from "@/lib/supabase";

/**
 * The pool's round prize as one small panel: what it is, who's behind it,
 * and, for a winner, the button to say it arrived. Always a member's
 * business's offer, never Scrumline's.
 */
export function PrizeLine({ prizes, round, onChange, compact = false }: { prizes: PoolPrize[]; round?: number; onChange?: () => void; compact?: boolean }) {
  const { members, me, pool } = useLeague();
  const [busy, setBusy] = useState(false);
  const nameOf = (id: string) => (id === me.user_id ? "you" : members.find((m) => m.user_id === id)?.display_name ?? "a mate");
  if (!prizes.length) return null;

  // The round this is about: the one asked for, else the one in play, else the next.
  const shown = round !== undefined
    ? prizes.find((p) => p.round === round)
    : prizes.find((p) => p.status === "in play") ?? prizes.find((p) => p.status === "upcoming");
  const owed = compact ? undefined
    : prizes.find((p) => p.status === "awaiting" && p.winners?.includes(me.user_id) && !p.received.includes(me.user_id));
  if (!shown && !owed) return null;

  async function received(p: PoolPrize) {
    setBusy(true);
    await supabase.from("prize_receipts").insert({ pool_id: pool!.id, round: p.round });
    setBusy(false);
    onChange?.();
  }

  return (
    <div className="prize">
      {shown && (
        <div className="prize-row">
          {shown.image_path && (
            <a href={prizePhotoUrl(shown.image_path)} target="_blank" rel="noreferrer"><img className="prize-thumb" src={prizePhotoUrl(shown.image_path)} alt={shown.prize} /></a>
          )}
          <div className="prize-text">
            <span className="prize-label">Round {shown.round} prize</span>
            <strong>{shown.prize}</strong>
            <span className="prize-meta">{shown.sponsor} · offered by {nameOf(shown.offered_by)}</span>
          </div>
        </div>
      )}
      {owed && (
        <div className="prize-row">
          <div className="prize-text">
            <span className="prize-label">You won round {owed.round}</span>
            <strong>{owed.prize}</strong>
            <span className="prize-meta">Tap once {owed.sponsor} has handed it over</span>
          </div>
          <button type="button" className="ghost prize-btn" disabled={busy} onClick={() => received(owed)}>Received</button>
        </div>
      )}
    </div>
  );
}
