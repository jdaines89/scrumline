"use client";

import { useEffect, useState } from "react";
import { useLeague } from "@/components/league";
import { readCache, writeCache } from "@/lib/cache";
import { logEvent } from "@/lib/events";
import { joinLink } from "@/lib/join-link";
import { bestMoment, type Moment, type Moments } from "@/lib/share-moments";
import { supabase } from "@/lib/supabase";

/** Your moments, from last visit's copy first so the card doesn't jump. */
export function useShareMoment(): Moment | null {
  const [m, setM] = useState<Moments | null>(() => readCache<Moments | null>("sharemoments") ?? null);
  useEffect(() => {
    supabase.rpc("my_share_moments").then(({ data, error }) => {
      if (error) return;
      const r = (data ?? null) as Moments | null;
      writeCache("sharemoments", r); setM(r);
    });
  }, []);
  return bestMoment(m);
}

/** The line at the foot of the full-time card: the moment in words, and a button that makes it a picture. */
export function ShareMomentLine({ moment }: { moment: Moment }) {
  return (
    <div className="ft-share">
      <span className="ft-share-text"><b>{moment.kicker}.</b> {moment.said}</span>
      <ShareMomentButton moment={moment} />
    </div>
  );
}

/** Makes the picture and opens the phone's share sheet (WhatsApp Status, Instagram), or saves it. Never posts anything itself. */
export function ShareMomentButton({ moment, label = "Share" }: { moment: Moment; label?: string }) {
  const { me } = useLeague();
  const [note, setNote] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    supabase.rpc("my_invite").then(({ data }) => setCode(((data ?? []) as { code: string }[])[0]?.code ?? null));
  }, []);
  async function share() {
    setNote(null);
    const blob = await drawMoment(moment, me.display_name);
    logEvent("moment_shared", { kind: moment.kind });
    const file = new File([blob], `scrumline-${moment.kind}.png`, { type: "image/png" });
    const site = `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}`;
    const text = `${moment.kicker}: ${moment.headline}. ${moment.detail}\n\nCall every match with me on Scrumline. Free to play, no betting, and it helps fund South African schools: ${joinLink(site, code)}`;
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text }); return; }
    } catch (e) { if ((e as Error).name === "AbortError") return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
    URL.revokeObjectURL(a.href);
    setNote("Saved the picture. Post it to your Status.");
  }
  return (
    <>
      <button type="button" className="ghost ft-share-btn" onClick={share}>{label}</button>
      {note && <p className="small muted ft-share-note">{note}</p>}
    </>
  );
}

/** The moment as a 1080x1920 picture, the shape of a WhatsApp Status or an Instagram Story, in the app's colours. */
export async function drawMoment(m: Moment, name: string): Promise<Blob> {
  const W = 1080, H = 1920, pad = 96;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const font = (w: number, px: number) => `${w} ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  // Full names always: shrink the type until the line fits rather than cutting it.
  const fit = (text: string, w: number, px: number, min: number) => {
    let s = px; g.font = font(w, s);
    while (g.measureText(text).width > W - pad * 2 && s > min) { s -= 2; g.font = font(w, s); }
    return s;
  };
  const wrap = (text: string) => {
    const out: string[] = []; let cur = "";
    for (const w of text.split(" ")) {
      const t = cur ? `${cur} ${w}` : w;
      if (g.measureText(t).width > W - pad * 2 && cur) { out.push(cur); cur = w; } else cur = t;
    }
    if (cur) out.push(cur);
    return out;
  };

  g.fillStyle = "#0d1412"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#1d6f4d"; g.fillRect(0, 0, W, 16);
  g.fillStyle = "#e8f0ec"; g.font = font(800, 48); g.fillText("SCRUMLINE", pad, 200);
  g.fillStyle = "#e0b23c"; g.font = font(700, 24); g.fillText("RUGBY PREDICTION LEAGUES", pad, 242);

  // The moment, centred in the picture's middle.
  let y = m.score ? 640 : 760;
  g.fillStyle = "#35c98a"; g.font = font(800, 40); g.fillText(m.kicker.toUpperCase(), pad, y);
  y += 40;
  if (m.score) {
    // A scoreboard: each team on its own line with its score on the right, full names shrunk to fit.
    y += 36;
    g.strokeStyle = "#24382f"; g.lineWidth = 2;
    for (const [team, pts] of [[m.score.home, m.score.home_score], [m.score.away, m.score.away_score]] as const) {
      g.beginPath(); g.moveTo(pad, y); g.lineTo(W - pad, y); g.stroke();
      g.fillStyle = "#e8f0ec"; g.font = font(800, 120); g.textAlign = "right"; g.fillText(String(pts), W - pad, y + 140); g.textAlign = "left";
      const room = W - pad * 2 - g.measureText(String(pts)).width - 40;
      let px = 72; g.font = font(700, px);
      while (g.measureText(team).width > room && px > 34) { px -= 2; g.font = font(700, px); }
      g.fillText(team, pad, y + 128);
      y += 180;
    }
    g.beginPath(); g.moveTo(pad, y); g.lineTo(W - pad, y); g.stroke();
  } else {
    // The headline wraps on to a second line before it shrinks too far.
    g.fillStyle = "#e8f0ec"; g.font = font(800, 96);
    const head = g.measureText(m.headline).width > W - pad * 2 ? wrap(m.headline) : [m.headline];
    for (const line of head.slice(0, 3)) {
      const s = fit(line, 800, 96, 56);
      y += s + 18; g.fillText(line, pad, y);
    }
  }
  y += 110;
  g.fillStyle = "#c9d8d0"; g.font = font(500, 46);
  for (const line of wrap(m.detail)) { g.fillText(line, pad, y); y += 62; }
  y += 30;
  g.fillStyle = "#8aa79a"; fit(name, 600, 40, 26); g.fillText(name, pad, y);

  // The way in, on a quiet band at the foot.
  const foot = 300;
  g.fillStyle = "#131e1b"; g.fillRect(0, H - foot, W, foot);
  g.fillStyle = "#e0b23c"; g.fillRect(0, H - foot, W, 4);
  g.fillStyle = "#e8f0ec"; g.font = font(800, 50); g.fillText("Call every match with me", pad, H - foot + 112);
  g.fillStyle = "#8aa79a"; g.font = font(500, 32);
  g.fillText("Free to play, no betting.", pad, H - foot + 172);
  g.fillText("Helping fund South African schools.", pad, H - foot + 220);
  return new Promise((ok) => c.toBlob((b) => ok(b!), "image/png"));
}
