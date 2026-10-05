"use client";

import { useEffect, useState } from "react";
import { roundName, roundText } from "@/lib/format";
import { logEvent } from "@/lib/events";
import { afterRoundLine, mateAsk, type AfterRound } from "@/lib/growth";
import { joinLink } from "@/lib/join-link";
import { supabase } from "@/lib/supabase";

const key = (season: string, round: number) => `sl:mate-card:${season}:${round}`;

/**
 * After a round's results: how you did in your biggest mates' league, and
 * one tap to send it to someone else. Shown for five days after the round,
 * until "Not now" or a share.
 */
export function BringAMate({ season, seasonName }: { season: string; seasonName: string }) {
  const [a, setA] = useState<AfterRound | null>(null);
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    supabase.rpc("after_round", { p_season: season }).then(({ data }) => {
      const r = data as AfterRound | null;
      if (!live || !r || !r.pool_id) return;
      try { if (localStorage.getItem(key(season, r.round))) return; } catch { /* show it */ }
      setA(r);
      try { if (!sessionStorage.getItem(key(season, r.round))) { sessionStorage.setItem(key(season, r.round), "1"); logEvent("mate_card_shown", { round: r.round }, r.pool_id); } } catch { /* fine */ }
    });
    supabase.rpc("my_invite").then(({ data }) => { if (live) setCode(((data ?? []) as { code: string }[])[0]?.code ?? null); });
    return () => { live = false; };
  }, [season]);

  if (!a || !a.pool_id || !a.join_code) return null;
  const site = `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}`;
  const link = joinLink(site, code, a.join_code);
  const text = `${roundName(a.round)} of the ${seasonName} is done and I'm ${a.of > 1 ? `in the mix in "${a.pool_name}"` : `playing "${a.pool_name}"`} on Scrumline. Join us for ${roundText(a.round + 1)}: call the score of every match, free, no betting.\n\nTap to join: ${link}`;

  function hide() {
    try { localStorage.setItem(key(season, a!.round), "1"); } catch { /* fine */ }
    setA(null);
  }

  return (
    <div className="card mate-card">
      <p className="mate-line">{afterRoundLine(a, roundName(a.round))}</p>
      <p className="sub">{mateAsk(a.members)}</p>
      <div className="row">
        <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"
          onClick={() => { logEvent("invite_shared", { from: "after_round", via: "whatsapp" }, a.pool_id!); hide(); }}>Send to a mate</a>
        <button type="button" className="ghost" onClick={hide}>Not now</button>
      </div>
    </div>
  );
}
