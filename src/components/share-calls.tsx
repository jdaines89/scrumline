"use client";

import { useState } from "react";
import { logEvent } from "@/lib/events";
import { joinLink } from "@/lib/join-link";
import { DESCRIPTOR, drawGround, drawMasthead, loadBrand } from "@/lib/share-brand";

/** One match on the picture: your call, and once it's played the real score and your points. */
export interface CallRow {
  home: string; away: string;
  homeColour: string | null; awayColour: string | null;
  call: [number, number];
  banker: boolean;
  final: [number, number] | null;
  pts: number | null;
}

const CHALK = "#f1efe6", GOLD = "#e0b23c", MUTED = "#a9b8ae";

/** Makes your calls for a round a story picture (before the games, or after with the real scores) and opens the share sheet, or saves it. Never posts anything itself. */
export function ShareCallsButton({ rows, round, tournament, name }: { rows: CallRow[]; round: string; tournament: string; name: string }) {
  const [note, setNote] = useState<string | null>(null);
  const after = rows.length > 0 && rows.every((r) => r.final);
  async function share() {
    setNote(null);
    const blob = await drawCalls(rows, { round, tournament, name, after });
    logEvent("moment_shared", { kind: after ? "calls_after" : "calls_before" });
    const file = new File([blob], `scrumline-${after ? "results" : "calls"}.jpg`, { type: "image/jpeg" });
    const site = `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}`;
    const text = `My ${round} ${after ? "calls and how they landed" : "calls"} on Scrumline. Every call builds something bigger than the game. Get our schools over the line. ${joinLink(site, null)}`;
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text }); return; }
    } catch (e) { if ((e as Error).name === "AbortError") return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
    URL.revokeObjectURL(a.href);
    setNote("Saved the picture. Post it to your Status or Story.");
  }
  return (
    <div className="share-calls">
      <button type="button" className="ghost" onClick={share}>{after ? "Share my results" : "Share my calls"}</button>
      {note && <p className="small muted">{note}</p>}
    </div>
  );
}

/**
 * Your round as a 1080x1920 picture, the shape of a WhatsApp Status or an Instagram Story.
 * Before the games: every match with your scoreline and your Banker. After: your call next to the
 * real score with the points each earned. Only your own calls ever appear.
 */
export async function drawCalls(rows: CallRow[], o: { round: string; tournament: string; name: string; after: boolean }): Promise<Blob> {
  const W = 1080, H = 1920, pad = 72;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const family = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
  const font = (w: number, px: number) => `${w} ${px}px ${family}`;
  const brand = await loadBrand();
  const fit = (text: string, w: number, px: number, min: number, room: number) => {
    let s = px; g.font = font(w, s);
    while (g.measureText(text).width > room && s > min) { s -= 2; g.font = font(w, s); }
    return s;
  };

  drawGround(g, W, H);
  drawMasthead(g, brand, pad, 70, 150);

  // The title: what this is, for which round.
  let y = 290;
  g.textBaseline = "alphabetic"; g.textAlign = "left";
  g.fillStyle = GOLD; g.letterSpacing = "4px";
  fit(o.tournament.toUpperCase(), 800, 32, 20, W - pad * 2); g.fillText(o.tournament.toUpperCase(), pad, y);
  g.letterSpacing = "0px";
  g.fillStyle = CHALK;
  const title = o.after ? `${o.round}: my calls and results` : `${o.round}: my calls`;
  const ts = fit(title, 900, 72, 40, W - pad * 2); g.fillText(title, pad, y += 12 + ts);
  g.fillStyle = MUTED;
  fit(`— ${o.name}`, 600, 38, 24, W - pad * 2); g.fillText(`— ${o.name}`, pad, y += 54);

  // The matches: one row each, shrinking evenly so any round fits.
  const top = y + 36, bottom = H - 330 - (o.after ? 100 : 0), n = rows.length;
  const rh = Math.min(150, (bottom - top) / Math.max(n, 1));
  const gap = rh * .1, boxH = rh - gap;
  const scale = boxH / 130;
  const numW = 150 * scale + 40;
  let total = 0;
  rows.forEach((r, i) => {
    const ry = top + i * rh;
    g.fillStyle = r.banker ? "rgba(224,178,60,.14)" : "rgba(6,12,8,.5)";
    g.beginPath(); g.roundRect(pad, ry, W - pad * 2, boxH, 20 * scale); g.fill();
    if (r.banker) { g.strokeStyle = GOLD; g.lineWidth = 3; g.stroke(); }
    // Team colour bars, as on the match card.
    const bar = 10 * scale, bh = (boxH - 28 * scale) / 2;
    g.fillStyle = r.homeColour || CHALK; g.beginPath(); g.roundRect(pad + 18 * scale, ry + 14 * scale, bar, bh - 4, 4); g.fill();
    g.fillStyle = r.awayColour || CHALK; g.beginPath(); g.roundRect(pad + 18 * scale, ry + 14 * scale + bh + 4, bar, bh - 4, 4); g.fill();
    // Full team names, stacked, shrunk to fit.
    const tx = pad + 18 * scale + bar + 22 * scale, room = W - pad * 2 - (tx - pad) - numW * (o.after ? 2.4 : 1.2) - 30;
    const fs = Math.min(fit(r.home, 700, 46 * scale, 22, room), fit(r.away, 700, 46 * scale, 22, room));
    g.font = font(700, fs); g.fillStyle = CHALK;
    g.fillText(r.home, tx, ry + boxH / 2 - 8 * scale);
    g.fillText(r.away, tx, ry + boxH / 2 + fs * .95);
    // Your call; after the game, the real score and the points.
    const right = W - pad - 22 * scale;
    g.textAlign = "right";
    let callLeft = right, callMid = ry + boxH / 2;
    if (o.after && r.final) {
      const pts = r.pts ?? 0; total += pts;
      g.fillStyle = pts > 0 ? GOLD : MUTED; g.font = font(900, 52 * scale);
      g.fillText(`+${pts}`, right, ry + boxH / 2 + 18 * scale);
      g.fillStyle = MUTED; g.font = font(600, 28 * scale); g.fillText(`FT ${r.final[0]}–${r.final[1]}`, right - 128 * scale, ry + boxH / 2 + 40 * scale);
      g.fillStyle = CHALK; g.font = font(900, 64 * scale); g.fillText(`${r.call[0]}–${r.call[1]}`, right - 128 * scale, ry + boxH / 2 - 8 * scale);
      callLeft = right - 128 * scale - g.measureText(`${r.call[0]}–${r.call[1]}`).width; callMid = ry + boxH / 2 - 28 * scale;
    } else {
      g.fillStyle = CHALK; g.font = font(900, 84 * scale); g.fillText(`${r.call[0]}–${r.call[1]}`, right, ry + boxH / 2 + 28 * scale);
      callLeft = right - g.measureText(`${r.call[0]}–${r.call[1]}`).width; callMid = ry + boxH / 2;
    }
    g.textAlign = "left";
    if (r.banker) {
      // A gold ×2 tab beside your call: this was the Banker.
      const ph = 44 * scale, pw = 96 * scale;
      g.fillStyle = GOLD; g.beginPath(); g.roundRect(callLeft - pw - 20 * scale, callMid - ph / 2, pw, ph, ph / 2); g.fill();
      g.fillStyle = "#14200f"; g.font = font(900, 28 * scale); g.textAlign = "center";
      g.fillText("×2", callLeft - pw / 2 - 20 * scale, callMid + 10 * scale); g.textAlign = "left";
    }
  });

  if (o.after) {
    g.fillStyle = GOLD; g.textAlign = "right"; g.font = font(900, 64);
    g.fillText(`${total} points`, W - pad, Math.min(top + n * rh + 70, H - 330 - 24));
    g.textAlign = "left";
  }

  // The way in, on a band at the foot.
  const foot = 300, fy = H - foot;
  g.fillStyle = "#080d09"; g.fillRect(0, fy, W, foot);
  g.fillStyle = GOLD; g.fillRect(0, fy, W, 4);
  g.fillStyle = GOLD; g.font = font(900, 58); g.letterSpacing = "1px"; g.fillText("CALL EVERY MATCH WITH ME", pad, fy + 112, W - pad * 2);
  g.letterSpacing = "0px";
  g.fillStyle = CHALK; g.font = font(600, 29); g.fillText(DESCRIPTOR, pad, fy + 174, W - pad * 2);
  g.fillStyle = MUTED; g.font = font(500, 32); g.fillText("Helping fund South African schools.", pad, fy + 224);

  return new Promise((ok) => c.toBlob((b) => ok(b!), "image/jpeg", .9));
}
