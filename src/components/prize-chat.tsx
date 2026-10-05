"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useLeague } from "@/components/league";
import type { PoolPrize } from "@/lib/prizes";
import { supabase } from "@/lib/supabase";
import { roundName } from "@/lib/format";

interface Msg { id: number; author_id: string; body: string; created_at: string }

/**
 * A private thread between a round prize's winner(s) and the member who offered it,
 * for sorting out the hand-over (size, pickup, address) away from the league chat.
 * Only those people can read or write it; the database checks that.
 */
export function PrizeChat({ prize, onClose }: { prize: PoolPrize; onClose: () => void }) {
  const { me, members, pool } = useLeague();
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const poolId = pool!.id;
  const nameOf = (id: string) => (id === me.user_id ? "You" : members.find((m) => m.user_id === id)?.display_name ?? "A mate");
  const giver = prize.offered_by === me.user_id;
  const others = giver ? (prize.winners ?? []).filter((u) => u !== me.user_id) : [prize.offered_by];
  const withWho = others.map(nameOf).join(" & ");

  const load = useCallback(async () => {
    const { data } = await supabase.from("prize_messages").select("id, author_id, body, created_at")
      .eq("pool_id", poolId).eq("round", prize.round).order("id");
    setMsgs((data ?? []) as Msg[]);
  }, [poolId, prize.round]);

  useEffect(() => {
    load();
    const ch = supabase.channel(`prize:${poolId}:${prize.round}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "prize_messages", filter: `pool_id=eq.${poolId}` },
        (p) => { const m = p.new as Msg & { round: number }; if (m.round === prize.round) setMsgs((xs) => xs?.some((x) => x.id === m.id) ? xs : [...(xs ?? []), m]); })
      .subscribe();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => { supabase.removeChannel(ch); document.removeEventListener("keydown", key); };
  }, [load, poolId, prize.round, onClose]);

  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [msgs]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true); setErr(null);
    const { data, error } = await supabase.from("prize_messages")
      .insert({ pool_id: poolId, round: prize.round, body }).select("id, author_id, body, created_at").single();
    setBusy(false);
    if (error) { setErr(error.code === "42501" || error.code === "22023" ? error.message : "That didn't send. Try again in a moment."); return; }
    setText("");
    setMsgs((xs) => xs?.some((x) => x.id === data.id) ? xs : [...(xs ?? []), data as Msg]);
  }

  return (
    <div className="pz-back" onClick={onClose}>
      <div className="pz-sheet pchat" role="dialog" aria-modal="true" aria-label={`Messages with ${withWho}`} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="pz-close" aria-label="Close" onClick={onClose}>×</button>
        <div className="pchat-head">
          <span className="prize-label">{roundName(prize.round)} prize · private</span>
          <strong>{withWho}</strong>
          <span className="prize-meta">{prize.prize} from {prize.sponsor}. Only you{others.length ? ` and ${withWho}` : ""} can see this.</span>
        </div>
        <div className="pchat-log" ref={log}>
          {msgs === null ? null : msgs.length === 0 ? (
            <p className="prize-meta pchat-empty">
              {giver ? `Say congrats and sort out how ${withWho} gets the prize: size, pickup or delivery.` : `Say thanks and sort out how you'll get it: size, pickup or delivery.`}
            </p>
          ) : msgs.map((m) => (
            <div key={m.id} className={`pchat-msg${m.author_id === me.user_id ? " mine" : ""}`}>
              <span className="pchat-who">{nameOf(m.author_id)}</span>
              <span className="pchat-body">{m.body}</span>
            </div>
          ))}
        </div>
        <form className="pchat-form" onSubmit={send}>
          <textarea id="prize-chat-text" rows={1} maxLength={1000} placeholder="Message" value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(e); } }} />
          <button type="submit" disabled={busy || !text.trim()}>Send</button>
        </form>
        {err && <p className="small pchat-err">{err}</p>}
      </div>
    </div>
  );
}
