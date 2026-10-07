"use client";

import { poolTitle } from "@/components/pool-name";
import { useEffect, useMemo, useState } from "react";
import { useLeague } from "@/components/league";
import { readCache, writeCache } from "@/lib/cache";
import { supabase } from "@/lib/supabase";
import { logEvent } from "@/lib/events";
import type { PoolPrize } from "@/lib/prizes";
import { logoUrl, sponsorEvent, type PoolSponsor } from "@/lib/sponsor";
import { useSeasonSponsors } from "@/lib/tournament-sponsor";
import type { LeaderRow } from "@/lib/types";
import { roundName } from "@/lib/format";
import { countsFrom } from "@/lib/rounds";

interface Scored {
  entry_id: number; round: number; match_id: string; total_pts: number; is_banker: boolean;
  pred_home: number; pred_away: number; real_home: number; real_away: number;
}

interface Line { label: string; text: string }
/** Who the card thanks at the bottom: the pool's sponsor and the business behind the round's prize, each named. */
interface Backer { label: string; name: string; logo: string | null }

/**
 * The latest round's story for one pool: who won it, who climbed, the best
 * Banker and the worst call. Built from scored calls, which are all locked,
 * so pool mates can already read every one of them. Share turns it into an
 * image for the group chat.
 */
export function RoundRecap({ rows, prizes = [], sponsor = null, round: only, inChat = false, onOpen }: {
  rows: LeaderRow[]; prizes?: PoolPrize[]; sponsor?: PoolSponsor | null;
  /** A set round (the chat's recap post); otherwise the latest round with scores. */
  round?: number;
  /** In the chat the recap is the card image itself; tapping it opens it full size. */
  inChat?: boolean; onOpen?: (url: string) => void;
}) {
  const { matches, teams, pool, season } = useLeague();
  const [all, setScored] = useState<Scored[]>(() => readCache<Scored[]>(`recap:${pool!.id}`) ?? []);
  // Rounds before a league starts counting aren't part of its story.
  const from = countsFrom(pool);
  const scored = useMemo(() => all.filter((s) => s.round >= from), [all, from]);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const tournament = useSeasonSponsors(season.id);
  const entries = rows.filter((r) => r.entry_id !== null);
  const ids = entries.map((r) => r.entry_id!).join(",");

  useEffect(() => {
    if (!ids) { setScored([]); return; }
    supabase.from("prediction_scores")
      .select("entry_id, round, match_id, total_pts, is_banker, pred_home, pred_away, real_home, real_away")
      .eq("season", season.id).in("entry_id", ids.split(",").map(Number))
      .then(({ data }) => { const r = (data ?? []) as Scored[]; writeCache(`recap:${pool!.id}`, r); setScored(r); });
  }, [ids, season.id, pool]);

  const recap = useMemo(() => {
    if (!scored.length || entries.length < 2) return null;
    const round = only ?? Math.max(...scored.map((s) => s.round));
    // The banter goes out under team names, with the person in brackets: "Scrum Dogs (Justin)".
    const name = new Map(entries.map((r) => [r.entry_id!, r.team_name ?? r.manager]));
    const upTo = (r: number, e: number) => scored.filter((s) => s.entry_id === e && s.round <= r).reduce((a, s) => a + s.total_pts, 0);
    const rank = (r: number, e: number) => 1 + entries.filter((x) => upTo(r, x.entry_id!) > upTo(r, e)).length;
    const inRound = scored.filter((s) => s.round === round);
    if (!inRound.length) return null;
    const roundPts = (e: number) => inRound.filter((s) => s.entry_id === e).reduce((a, s) => a + s.total_pts, 0);
    const complete = matches.filter((m) => m.round === round).every((m) => m.home_score !== null);
    const matchName = (id: string) => {
      const m = matches.find((x) => x.id === id);
      return m ? `${teams.get(m.home_team_id)?.display_name} v ${teams.get(m.away_team_id)?.display_name}` : "";
    };
    const who = (es: number[]) => es.map((e) => name.get(e)).join(" & ");
    const lines: Line[] = [];

    const best = Math.max(...entries.map((r) => roundPts(r.entry_id!)));
    lines.push({ label: "Round winner", text: `${who(entries.filter((r) => roundPts(r.entry_id!) === best).map((r) => r.entry_id!))} with ${best} pts` });

    // The round's prize, once the round is decided. The app works out the winner (ties on exact scores, then right results).
    const prize = prizes.find((p) => p.round === round && p.winners?.length);
    if (prize) {
      const byUser = new Map(entries.map((r) => [r.user_id, r.manager]));
      const winners = prize.winners!.map((u) => byUser.get(u) ?? "A player").join(" & ");
      lines.push({ label: "Prize", text: `${winners} win${prize.winners!.length === 1 ? "s" : ""} the ${prize.prize}, thanks to ${prize.sponsor}` });
    }

    if (round > Math.min(...scored.map((s) => s.round))) {
      const moves = entries.map((r) => ({ e: r.entry_id!, up: rank(round - 1, r.entry_id!) - rank(round, r.entry_id!) }));
      const top = Math.max(...moves.map((m) => m.up));
      if (top > 0) lines.push({ label: "Biggest climber", text: `${who(moves.filter((m) => m.up === top).map((m) => m.e))}, up ${top} place${top === 1 ? "" : "s"}` });
    }

    const bankers = inRound.filter((s) => s.is_banker);
    if (bankers.length) {
      const b = bankers.reduce((x, y) => (y.total_pts > x.total_pts ? y : x));
      lines.push({ label: "Banker of the round", text: b.total_pts > 0
        ? `${name.get(b.entry_id)}, ${b.total_pts} pts on ${matchName(b.match_id)}`
        : `Nobody. Every Banker scored zero` });
    }

    const miss = (s: Scored) => Math.abs(s.pred_home - s.real_home) + Math.abs(s.pred_away - s.real_away);
    const worst = inRound.reduce((x, y) => (miss(y) > miss(x) ? y : x));
    lines.push({ label: "Worst call", text: `${name.get(worst.entry_id)} said ${worst.pred_home}–${worst.pred_away}, it finished ${worst.real_home}–${worst.real_away} (${matchName(worst.match_id)})` });

    const leaders = entries.filter((r) => rank(round, r.entry_id!) === 1).map((r) => r.entry_id!);
    lines.push({ label: "Top of the league", text: `${who(leaders)} on ${upTo(round, leaders[0])} pts` });
    const table = entries.map((r) => ({ name: r.team_name ?? r.manager, pts: upTo(round, r.entry_id!), rank: rank(round, r.entry_id!) }))
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name)).slice(0, 6);
    // A round prize's business is that round's backer, even before its winner is known.
    const biz = prizes.find((p) => p.round === round);
    return { round, complete, lines, table, biz: biz ? { name: biz.sponsor, logo: biz.sponsor_logo } : null };
  }, [scored, entries, matches, teams, prizes, only]);

  const title = recap ? `${roundName(recap.round)} ${recap.complete ? "recap" : "so far"}` : "";
  // Everyone who backed this round, biggest first: the tournament, its round, this league, the round's prize.
  const backers = useMemo(() => {
    const out: Backer[] = [];
    if (!recap) return out;
    const add = (label: string, name: string, logo: string | null) => { if (!out.some((b) => b.name === name)) out.push({ label, name, logo }); };
    const titleSponsor = tournament.find((t) => t.round === null), roundSponsor = tournament.find((t) => t.round === recap.round);
    if (titleSponsor) add("Tournament sponsor", titleSponsor.display_name, titleSponsor.logo_path);
    if (roundSponsor) add(`${roundName(recap.round)} sponsor`, roundSponsor.display_name, roundSponsor.logo_path);
    if (sponsor) add("League sponsor", sponsor.display_name, sponsor.logo_path);
    if (recap.biz) add(`${roundName(recap.round)} prize by`, recap.biz.name, recap.biz.logo);
    return out;
  }, [recap, tournament, sponsor]);
  const sub = `${poolTitle(pool!)} · ${season.name}`;
  const card = (type: "image/png" | "image/jpeg") => drawCard(sub, title, recap!.lines, recap!.table, backers, type);

  // In the chat, draw the card once its story is known and show the picture.
  const [img, setImg] = useState<{ url: string; w: number; h: number } | null>(null);
  const story = recap && inChat ? JSON.stringify([sub, title, recap.lines, recap.table, backers]) : "";
  useEffect(() => {
    if (!story) return;
    let live = true, url = "";
    const [s, t, lines, table, bk] = JSON.parse(story) as [string, string, Line[], { name: string; pts: number; rank: number }[], Backer[]];
    drawCard(s, t, lines, table, bk, "image/jpeg").then(async (blob) => {
      if (!live) return;
      url = URL.createObjectURL(blob);
      const bmp = await createImageBitmap(blob).catch(() => null);
      setImg({ url, w: bmp?.width ?? 1080, h: bmp?.height ?? 1350 });
      bmp?.close();
    });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [story]);

  if (!recap) return null;

  async function share() {
    setNote(null);
    const blob = await card("image/png");
    if (sponsor) sponsorEvent(sponsor.booking_id, "share");
    logEvent("recap_shared", { round: recap!.round }, pool!.id);
    const file = new File([blob], `scrumline-round-${recap!.round}.png`, { type: "image/png" });
    const text = `${title}, ${poolTitle(pool!)}\n` + recap!.lines.map((l) => `${l.label}: ${l.text}`).join("\n");
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text }); return; }
    } catch (e) { if ((e as Error).name === "AbortError") return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
    URL.revokeObjectURL(a.href);
    setNote("Saved the image. Drop it in the group chat.");
  }

  if (inChat) {
    return (
      <div className="recapchat">
        {img
          // eslint-disable-next-line @next/next/no-img-element
          ? <img className="photo" src={img.url} alt={title} style={{ width: "100%", height: "auto", aspectRatio: `${img.w} / ${img.h}`, maxHeight: "none" }}
              onClick={() => onOpen?.(img.url)} />
          : <div className="photo skeleton" style={{ width: "100%", height: "auto", aspectRatio: "1080 / 1350", maxHeight: "none" }} />}
        <button type="button" className="linkish recapmore" onClick={share}>Share</button>
        {note && <p className="small muted" style={{ margin: "4px 0 0" }}>{note}</p>}
      </div>
    );
  }

  return (
    <div className="recap">
      <div className="recaphead">
        <h3>{title}</h3>
        <span className="recapbtns">
          <button type="button" className="bank" onClick={share}>Share</button>
        </span>
      </div>
      <dl>
        {(open ? recap.lines : recap.lines.slice(0, 1)).map((l) => <div key={l.label}><dt>{l.label}</dt><dd>{l.text}</dd></div>)}
      </dl>
      {recap.lines.length > 1 && (
        <button type="button" className="linkish recapmore" onClick={() => setOpen(!open)}>{open ? "Show less" : "Full recap"}</button>
      )}
      {note && <p className="small muted" style={{ margin: "6px 0 0" }}>{note}</p>}
    </div>
  );
}

// The recap as a 1080x1350 image, in the app's colours, for WhatsApp and friends.
async function drawCard(sub: string, title: string, lines: Line[], table: { name: string; pts: number; rank: number }[],
  backers: Backer[], type: "image/png" | "image/jpeg"): Promise<Blob> {
  const logos = await Promise.all(backers.map((b) => (b.logo ? loadImage(logoUrl(b.logo)) : Promise.resolve(null))));
  // Drawn on a tall sheet first, then cut to fit: at least 1080x1350, longer when the story needs it.
  const W = 1080, pad = 80, row = 96, foot = backers.length ? 32 + row * backers.length : 0;
  let H = 2600; // room for any story; the copy below is cut to what was drawn
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0d1412"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#1d6f4d"; g.fillRect(0, 0, W, 14);
  const font = (w: number, px: number) => `${w} ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  g.fillStyle = "#e8f0ec"; g.font = font(800, 44); g.fillText("SCRUMLINE", pad, 120);
  g.fillStyle = "#e0b23c"; g.font = font(700, 22); g.fillText("GET YOUR SCHOOL OVER THE LINE", pad, 158);
  g.fillStyle = "#e8f0ec"; g.font = font(800, 72); g.fillText(title, pad, 290);
  g.fillStyle = "#8aa79a"; g.font = font(500, 32); g.fillText(sub, pad, 342);

  const wrap = (text: string, max: number) => {
    const out: string[] = []; let cur = "";
    for (const w of text.split(" ")) {
      const t = cur ? `${cur} ${w}` : w;
      if (g.measureText(t).width > max && cur) { out.push(cur); cur = w; } else cur = t;
    }
    if (cur) out.push(cur);
    return out;
  };
  let y = 440;
  for (const l of lines) {
    g.fillStyle = "#35c98a"; g.font = font(700, 26); g.fillText(l.label.toUpperCase(), pad, y);
    g.fillStyle = "#e8f0ec"; g.font = font(600, 38);
    for (const row of wrap(l.text, W - pad * 2)) { y += 50; g.fillText(row, pad, y); }
    y += 70;
  }
  // The pool table after this round, top six.
  g.strokeStyle = "#24382f"; g.lineWidth = 2;
  for (const t of table) {
    g.beginPath(); g.moveTo(pad, y - 44); g.lineTo(W - pad, y - 44); g.stroke();
    g.fillStyle = "#8aa79a"; g.font = font(600, 32); g.fillText(String(t.rank), pad, y);
    g.fillStyle = "#e8f0ec"; g.fillText(t.name, pad + 60, y);
    g.font = font(800, 32); g.textAlign = "right"; g.fillText(String(t.pts), W - pad, y); g.textAlign = "left";
    y += 62;
  }
  H = Math.max(1350, y - 10 + foot);
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const o = out.getContext("2d")!;
  o.drawImage(c, 0, 0);
  // The backers' footer: each one's logo and name on a quiet band, like the sponsor line in the app.
  if (backers.length) {
    o.fillStyle = "#131e1b"; o.fillRect(0, H - foot, W, foot);
    backers.forEach((b, i) => {
      const top = H - foot + 16 + i * row, s = 64, base = top + 44;
      o.fillStyle = "#8aa79a"; o.font = font(500, 26); o.fillText(b.label, pad, base);
      let x = pad + 300;
      const logo = logos[i];
      if (logo) {
        o.save(); o.beginPath(); o.roundRect(x, top + 2, s, s, 12); o.fillStyle = "#fff"; o.fill(); o.clip();
        const k = Math.min((s - 8) / logo.width, (s - 8) / logo.height);
        o.drawImage(logo, x + (s - logo.width * k) / 2, top + 2 + (s - logo.height * k) / 2, logo.width * k, logo.height * k);
        o.restore();
        x += s + 18;
      }
      o.fillStyle = "#e8f0ec"; o.font = font(700, 32); o.fillText(b.name, x, base);
    });
  }
  return new Promise((ok) => out.toBlob((b) => ok(b!), type, 0.88));
}

// A logo for the canvas; without CORS the canvas couldn't be saved, so a logo that won't load is left out.
function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((ok) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => ok(img);
    img.onerror = () => ok(null);
    img.src = src;
    setTimeout(() => ok(null), 4000);
  });
}
