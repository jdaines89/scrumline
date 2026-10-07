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
  const { me, teams } = useLeague();
  const [note, setNote] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    supabase.rpc("my_invite").then(({ data }) => setCode(((data ?? []) as { code: string }[])[0]?.code ?? null));
  }, []);
  async function share() {
    setNote(null);
    // Each team's own colour beside its name, when the app knows it.
    const colour = (n?: string) => [...teams.values()].find((t) => t.display_name === n)?.colour ?? null;
    const blob = await drawMoment(moment, me.display_name, [colour(moment.score?.home), colour(moment.score?.away)]);
    logEvent("moment_shared", { kind: moment.kind });
    const file = new File([blob], `scrumline-${moment.kind}.jpg`, { type: "image/jpeg" });
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

/**
 * The moment as a 1080x1920 picture, the shape of a WhatsApp Status or an Instagram Story.
 * The same match-day grit as the chat stickers: a dark mown pitch with mud and grain, chalk lines,
 * and one big stamped word. Other players only ever appear as counts.
 */
export async function drawMoment(m: Moment, name: string, colours: (string | null)[] = []): Promise<Blob> {
  const W = 1080, H = 1920, pad = 84;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const family = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
  const font = (w: number, px: number) => `${w} ${px}px ${family}`;
  const rand = seeded(`${m.kind}|${m.headline}`);
  const CHALK = "#f1efe6", GOLD = "#e0b23c", MUTED = "#a9b8ae";
  const logo = await loadImage(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/icons/icon-192.png`);
  // Full names always: shrink the type until the line fits rather than cutting it.
  const fit = (text: string, w: number, px: number, min: number, room = W - pad * 2) => {
    let s = px; g.font = font(w, s);
    while (g.measureText(text).width > room && s > min) { s -= 2; g.font = font(w, s); }
    return s;
  };

  // The pitch: dark grass, mown in bands, with mud worked in from the edges.
  const grass = g.createLinearGradient(0, 0, 0, H);
  grass.addColorStop(0, "#1f3a28"); grass.addColorStop(.55, "#142619"); grass.addColorStop(1, "#0a130d");
  g.fillStyle = grass; g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 240) { g.fillStyle = "rgba(255,255,255,.028)"; g.fillRect(0, y, W, 120); }
  for (let i = 0; i < 26; i++) {
    const edge = rand() < .5;
    const x = edge ? (rand() < .5 ? rand() * 220 : W - rand() * 220) : rand() * W;
    const y = H * (.35 + rand() * .65), r = 60 + rand() * 220;
    const mud = g.createRadialGradient(x, y, 0, x, y, r);
    mud.addColorStop(0, `rgba(58,40,22,${.28 + rand() * .25})`); mud.addColorStop(1, "rgba(58,40,22,0)");
    g.fillStyle = mud; g.beginPath(); g.ellipse(x, y, r, r * (.45 + rand() * .4), rand() * Math.PI, 0, Math.PI * 2); g.fill();
  }
  // A light from above, so the middle of the picture reads first.
  const glow = g.createRadialGradient(W / 2, H * .42, 80, W / 2, H * .42, H * .7);
  glow.addColorStop(0, "rgba(255,255,255,.07)"); glow.addColorStop(1, "rgba(0,0,0,.35)");
  g.fillStyle = glow; g.fillRect(0, 0, W, H);

  // Chalk: a rough line made of a few uneven passes, like a groundsman's marker.
  const chalkLine = (x1: number, y1: number, x2: number, y2: number, width: number, alpha: number, dash: number[] = []) => {
    g.save(); g.setLineDash(dash); g.lineCap = "round";
    for (let k = 0; k < 4; k++) {
      g.strokeStyle = `rgba(241,239,230,${alpha * (.4 + rand() * .5)})`; g.lineWidth = width * (.5 + rand() * .7);
      g.beginPath(); g.moveTo(x1 + (rand() - .5) * 4, y1 + (rand() - .5) * 4);
      g.lineTo(x2 + (rand() - .5) * 4, y2 + (rand() - .5) * 4); g.stroke();
    }
    g.restore();
  };
  chalkLine(-20, 330, W + 20, 312, 10, .55);

  // The masthead: the shield and the name in chalk.
  if (logo) g.drawImage(logo, pad, 120, 96, 96);
  g.fillStyle = CHALK; g.font = font(900, 54); g.fillText("SCRUMLINE", pad + (logo ? 120 : 0), 176);
  g.fillStyle = GOLD; g.font = font(700, 22); g.letterSpacing = "4px";
  g.fillText("GET YOUR SCHOOL OVER THE LINE", pad + (logo ? 122 : 2), 210); g.letterSpacing = "0px";

  // The stamp: one big word, set at an angle in a ruled box, worn where the ink missed.
  const word = (m.stamp ?? m.kicker).toUpperCase();
  const stamp = document.createElement("canvas");
  stamp.width = W; stamp.height = 420;
  const s = stamp.getContext("2d")!;
  let px = 230; s.font = font(900, px); s.letterSpacing = "-6px";
  while (s.measureText(word).width > W - pad * 2 - 90 && px > 110) { px -= 4; s.font = font(900, px); }
  const tw = s.measureText(word).width, bw = tw + 90, bh = px * .82 + 80, bx = (W - bw) / 2, by = (420 - bh) / 2;
  s.strokeStyle = GOLD; s.lineWidth = 12; s.strokeRect(bx, by, bw, bh);
  s.lineWidth = 4; s.strokeRect(bx + 20, by + 20, bw - 40, bh - 40);
  s.fillStyle = GOLD; s.textBaseline = "middle"; s.textAlign = "center"; s.fillText(word, W / 2, 210 + px * .04);
  s.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 2600; i++) {
    s.globalAlpha = .25 + rand() * .75;
    s.beginPath(); s.arc(rand() * W, rand() * 420, rand() * (rand() < .96 ? 2.2 : 7), 0, Math.PI * 2); s.fill();
  }
  g.save(); g.translate(W / 2, 490); g.rotate(-5 * Math.PI / 180);
  g.shadowColor = "rgba(0,0,0,.45)"; g.shadowBlur = 18; g.drawImage(stamp, -W / 2, -210); g.restore();

  // The game as a chalk scoreboard, each team with its colour; or the big line.
  let y = 740;
  if (m.score) {
    const rows = [[m.score.home, m.score.home_score, colours[0]], [m.score.away, m.score.away_score, colours[1]]] as const;
    g.fillStyle = "rgba(6,12,8,.55)"; roundRect(g, pad - 24, y - 24, W - (pad - 24) * 2, 400, 24); g.fill();
    for (const [team, pts, colour] of rows) {
      g.fillStyle = colour || CHALK; roundRect(g, pad, y + 26, 16, 128, 8); g.fill();
      g.strokeStyle = "rgba(241,239,230,.5)"; g.lineWidth = 2; g.stroke();
      g.fillStyle = CHALK; g.font = font(900, 168); g.textAlign = "right"; g.fillText(String(pts), W - pad, y + 150); g.textAlign = "left";
      const room = W - pad * 2 - 48 - g.measureText(String(pts)).width - 30;
      fit(team, 800, 76, 36, room); g.fillText(team, pad + 48, y + 116);
      y += 180;
      if (team === m.score.home) chalkLine(pad + 48, y - 2, W - pad, y - 2, 3, .35);
    }
    y += 40;
    if (m.call) {
      g.font = font(800, 40); g.letterSpacing = "2px";
      const t = m.call.toUpperCase(), w = g.measureText(t).width + 64;
      g.save(); g.translate(pad, y + 30); g.rotate(-1.5 * Math.PI / 180);
      g.fillStyle = GOLD; roundRect(g, 0, -10, w, 76, 10); g.fill();
      g.fillStyle = "#14200f"; g.fillText(t, 32, 42); g.restore(); g.letterSpacing = "0px";
      y += 110;
    }
  } else {
    // The league or class, with a chalk line under it like a try line.
    g.fillStyle = GOLD; g.letterSpacing = "3px"; fit((m.over ?? m.kicker).toUpperCase(), 800, 36, 24); g.fillText((m.over ?? m.kicker).toUpperCase(), pad, y + 70); g.letterSpacing = "0px";
    g.fillStyle = CHALK; const hs = fit(m.headline, 900, 128, 60);
    y += 90 + hs; g.fillText(m.headline, pad, y);
    chalkLine(pad, y + 50, W - pad, y + 44, 6, .55);
    y += 90;
  }

  // The figure that makes it worth posting.
  if (m.score) y = Math.max(y, 1140);
  if (m.stat) {
    g.fillStyle = CHALK; fit(m.stat, 900, 140, 80); g.fillText(m.stat, pad, y + 130);
    g.fillStyle = MUTED; fit(m.statLabel ?? "", 600, 42, 28); g.fillText(m.statLabel ?? "", pad, y + 202);
    y += 202;
  }
  g.fillStyle = CHALK; fit(`— ${name}`, 700, 44, 28); g.fillText(`— ${name}`, pad, Math.min(y + 96, H - 330));

  // Grain over everything above the foot, like a photo of a muddy pitch.
  const img = g.getImageData(0, 0, W, H - 300);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - .5) * 26;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);

  // The way in, on a torn dark band at the foot.
  const foot = 300, top = H - foot;
  g.fillStyle = "#080d09"; g.beginPath(); g.moveTo(0, top + 10);
  for (let x = 0; x <= W; x += 24) g.lineTo(x, top + (rand() - .5) * 18);
  g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fill();
  g.fillStyle = GOLD; g.font = font(900, 58); g.letterSpacing = "1px"; g.fillText("CALL EVERY MATCH WITH ME", pad, top + 118, W - pad * 2);
  g.letterSpacing = "0px";
  g.fillStyle = CHALK; g.font = font(600, 34); g.fillText("Free to play. No betting.", pad, top + 180);
  g.fillStyle = MUTED; g.font = font(500, 32); g.fillText("Helping fund South African schools.", pad, top + 228);
  // A photo-like picture: JPEG keeps the grain at a size that sends quickly.
  return new Promise((ok) => c.toBlob((b) => ok(b!), "image/jpeg", .9));
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.roundRect(x, y, w, h, r);
}

// The same picture for the same moment every time: a small seeded random.
function seeded(key: string) {
  let h = 2166136261;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((ok) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => ok(null);
    img.src = src;
    setTimeout(() => ok(null), 3000);
  });
}
