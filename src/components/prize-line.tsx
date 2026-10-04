"use client";

import { useState } from "react";
import { useLeague } from "@/components/league";
import { PrizeDetail } from "@/components/prize-detail";
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
  const [open, setOpen] = useState<PoolPrize | null>(null);
  const nameOf = (id: string) => (id === me.user_id ? "you" : members.find((m) => m.user_id === id)?.display_name ?? "a mate");
  if (!prizes.length) return null;

  // The round this is about: the one asked for, else the one in play, else the next.
  const shown = round !== undefined
    ? prizes.find((p) => p.round === round)
    : prizes.find((p) => p.status === "in play") ?? prizes.find((p) => p.status === "upcoming");
  const owed = compact ? undefined
    : prizes.find((p) => p.status === "awaiting" && p.winners?.includes(me.user_id) && !p.received.includes(me.user_id));
  // The latest round someone won, for everyone to see: until it's handed over, and a week after.
  const won = compact || round !== undefined ? undefined : latestWin(prizes);
  const cheer = won && won !== owed ? won : undefined;
  if (!shown && !owed && !cheer) return null;

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
          <button type="button" className="prize-open" aria-haspopup="dialog" onClick={() => setOpen(shown)}>
            {shown.image_path && <img className="prize-thumb" src={prizePhotoUrl(shown.image_path)} alt={shown.prize} />}
            <div className="prize-text">
              <span className="prize-label">Round {shown.round} prize</span>
              <strong>{shown.prize}</strong>
              <span className="prize-meta">{shown.sponsor} · offered by {nameOf(shown.offered_by)}</span>
            </div>
            <span className="prize-more" aria-hidden="true">›</span>
          </button>
        </div>
      )}
      {cheer && (
        <div className="prize-row">
          <button type="button" className="prize-open" aria-haspopup="dialog" onClick={() => setOpen(cheer)}>
            {cheer.image_path && <img className="prize-thumb small" src={prizePhotoUrl(cheer.image_path)} alt={cheer.prize} />}
            <div className="prize-text">
              <span className="prize-label">Round {cheer.round} winner 🏆</span>
              <strong>{winners(cheer.winners!, nameOf)} won the {cheer.prize}</strong>
              <span className="prize-meta">{cheer.sponsor} · {cheer.status === "delivered" ? "handed over" : "on its way"}</span>
            </div>
            <span className="prize-more" aria-hidden="true">›</span>
          </button>
        </div>
      )}
      {owed && (
        <div className="prize-row">
          <div className="prize-text" onClick={() => setOpen(owed)} style={{ cursor: "pointer" }}>
            <span className="prize-label">You won round {owed.round}</span>
            <strong>{owed.prize}</strong>
            <span className="prize-meta">Tap once {owed.sponsor} has handed it over</span>
          </div>
          <button type="button" className="ghost prize-btn" disabled={busy} onClick={() => received(owed)}>Received</button>
        </div>
      )}
      {open && <PrizeDetail prize={open} nameOf={(id) => (id === me.user_id ? "you" : nameOf(id))} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** The most recent round prize with a winner, while it's news: not yet handed over, or handed over in the last week. */
export function latestWin<P extends Pick<PoolPrize, "round" | "status" | "winners" | "due_at">>(prizes: P[]): P | undefined {
  const week = 7 * 24 * 3600 * 1000;
  return prizes.filter((p) => p.winners?.length && (p.status === "awaiting"
    || (p.status === "delivered" && !!p.due_at && Date.now() < new Date(p.due_at).getTime() - week)))
    .sort((a, b) => b.round - a.round)[0];
}

/** "You", "Christo", "Christo and Andy", "Christo, Andy and 2 more". */
export function winners(ids: string[], nameOf: (id: string) => string): string {
  const n = ids.map(nameOf).map((x, i) => (i === 0 ? x.charAt(0).toUpperCase() + x.slice(1) : x));
  return n.length <= 2 ? n.join(" and ") : `${n.slice(0, 2).join(", ")} and ${n.length - 2} more`;
}
