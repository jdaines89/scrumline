"use client";

import { useEffect, useState } from "react";
import { PrizeChat } from "@/components/prize-chat";
import { useLeague } from "@/components/league";
import { PrizeDetail } from "@/components/prize-detail";
import { prizePhotoUrl, type PoolPrize } from "@/lib/prizes";
import { supabase } from "@/lib/supabase";
import { roundName, roundText } from "@/lib/format";

/**
 * The pool's round prize as one small panel: what it is, who's behind it,
 * and, for a winner, the button to say it arrived. Always a member's
 * business's offer, never Scrumline's.
 */
export function PrizeLine({ prizes, round, onChange, compact = false }: { prizes: PoolPrize[]; round?: number; onChange?: () => void; compact?: boolean }) {
  const { members, me, pool } = useLeague();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<PoolPrize | null>(null);
  const [chat, setChat] = useState<PoolPrize | null>(null);
  const nameOf = (id: string) => (id === me.user_id ? "you" : members.find((m) => m.user_id === id)?.display_name ?? "a mate");
  // The round this is about: the one asked for, else the one in play, else the next.
  const shown = round !== undefined
    ? prizes.find((p) => p.round === round)
    : prizes.find((p) => p.status === "in play") ?? prizes.find((p) => p.status === "upcoming");
  const owed = compact ? undefined
    : prizes.find((p) => p.status === "awaiting" && p.winners?.includes(me.user_id) && !p.received.includes(me.user_id));
  // A prize this player's business owes: won, not yet confirmed received.
  const giving = compact || round !== undefined ? undefined
    : prizes.find((p) => p.status === "awaiting" && p.offered_by === me.user_id && p.winners?.length && !p.winners.includes(me.user_id));
  // The latest round someone won, for everyone to see: until it's handed over, and a week after.
  const won = compact || round !== undefined ? undefined : latestWin(prizes);
  const cheer = won && won !== owed && won !== giving ? won : undefined;
  // A phone alert for a prize message links here with ?prize=<round>: open that thread.
  const linked = typeof window === "undefined" ? null : Number(new URLSearchParams(window.location.search).get("prize")) || null;
  const toOpen = linked ? [owed, giving].find((p) => p?.round === linked) : undefined;
  useEffect(() => {
    if (!toOpen) return;
    setChat(toOpen);
    const q = new URLSearchParams(window.location.search);
    q.delete("prize");
    window.history.replaceState(null, "", window.location.pathname + (q.size ? `?${q}` : ""));
  }, [toOpen]);
  if (!prizes.length || (!shown && !owed && !cheer && !giving)) return null;

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
              <span className="prize-label">{roundName(shown.round)} prize</span>
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
              <span className="prize-label">{roundName(cheer.round)} winner 🏆</span>
              <strong>{winners(cheer.winners!, nameOf)} won the {cheer.prize}</strong>
              <span className="prize-meta">{cheer.sponsor} · {cheer.status === "delivered" ? "handed over" : "on its way"}</span>
            </div>
            <span className="prize-more" aria-hidden="true">›</span>
          </button>
        </div>
      )}
      {giving && (
        <div className="prize-row prize-won">
          <div className="prize-text" onClick={() => setOpen(giving)} style={{ cursor: "pointer" }}>
            <span className="prize-label">To hand over · {roundText(giving.round)}</span>
            <strong>{winners(giving.winners!, nameOf)} won your {giving.prize}</strong>
            <span className="prize-meta">Get it to {giving.winners!.length > 1 ? "them" : winners(giving.winners!, nameOf)}{giving.due_at ? ` by ${day(giving.due_at)}` : ""}. They tap Received once they have it.</span>
          </div>
          <span className="prize-acts">
            <button type="button" className="prize-btn" onClick={() => setChat(giving)}>Message</button>
          </span>
        </div>
      )}
      {owed && (
        <div className="prize-row prize-won">
          <div className="prize-text" onClick={() => setOpen(owed)} style={{ cursor: "pointer" }}>
            <span className="prize-label">You won {roundText(owed.round)} 🏆</span>
            <strong>{owed.prize}</strong>
            <span className="prize-meta">{nameOf(owed.offered_by) === "you" ? owed.sponsor : `${cap(nameOf(owed.offered_by))} from ${owed.sponsor}`} will sort out getting it to you{owed.due_at ? ` by ${day(owed.due_at)}` : ""}. Tap Received once you have it.</span>
          </div>
          <span className="prize-acts">
            <button type="button" className="prize-btn" disabled={busy} onClick={() => received(owed)}>Received</button>
            {owed.offered_by !== me.user_id && <button type="button" className="ghost prize-btn" onClick={() => setChat(owed)}>Message</button>}
          </span>
        </div>
      )}
      {chat && <PrizeChat prize={chat} onClose={() => setChat(null)} />}
      {open && <PrizeDetail prize={open} nameOf={(id) => (id === me.user_id ? "you" : nameOf(id))} onClose={() => setOpen(null)} />}
    </div>
  );
}

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

/** "Sat 17 Oct", in South African time. */
export function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg", weekday: "short", day: "numeric", month: "short" });
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
