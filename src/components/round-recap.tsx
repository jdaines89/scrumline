"use client";

import { useEffect, useMemo, useState } from "react";
import { useLeague } from "@/components/league";
import { readCache, writeCache } from "@/lib/cache";
import { supabase } from "@/lib/supabase";
import type { PoolPrize } from "@/lib/prizes";
import { sponsorEvent, type PoolSponsor } from "@/lib/sponsor";
import type { LeaderRow } from "@/lib/types";

interface Scored {
  entry_id: number; round: number; match_id: string; total_pts: number; is_banker: boolean;
  pred_home: number; pred_away: number; real_home: number; real_away: number;
}

interface Line { label: string; text: string }

/**
 * The latest round's story for one pool: who won it, who climbed, the best
 * Banker and the worst call. Built from scored calls, which are all locked,
 * so pool mates can already read every one of them. Share turns it into an
 * image for the group chat.
 */
export function RoundRecap({ rows, prizes = [], sponsor = null }: { rows: LeaderRow[]; prizes?: PoolPrize[]; sponsor?: PoolSponsor | null }) {
  const { matches, teams, pool, season } = useLeague();
  const [scored, setScored] = useState<Scored[]>(() => readCache<Scored[]>(`recap:${pool!.id}`) ?? []);
  const [note, setNote] = useState<string | null>(null);
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
    const round = Math.max(...scored.map((s) => s.round));
    // The banter goes out under team names, with the person in brackets: "Scrum Dogs (Justin)".
    const name = new Map(entries.map((r) => [r.entry_id!, r.team_name ? `${r.team_name} (${r.manager})` : r.manager]));
    const upTo = (r: number, e: number) => scored.filter((s) => s.entry_id === e && s.round <= r).reduce((a, s) => a + s.total_pts, 0);
    const rank = (r: number, e: number) => 1 + entries.filter((x) => upTo(r, x.entry_id!) > upTo(r, e)).length;
    const inRound = scored.filter((s) => s.round === round);
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
      const winners = prize.winners!.map((u) => byUser.get(u) ?? "A mate").join(" & ");
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
    lines.push({ label: "Top of the pool", text: `${who(leaders)} on ${upTo(round, leaders[0])} pts` });
    const table = entries.map((r) => ({ name: r.team_name ?? r.manager, pts: upTo(round, r.entry_id!), rank: rank(round, r.entry_id!) }))
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name)).slice(0, 6);
    return { round, complete, lines, table };
  }, [scored, entries, matches, teams, prizes]);

  if (!recap) return null;
  const title = `Round ${recap.round} ${recap.complete ? "recap" : "so far"}`;

  async function share() {
    setNote(null);
    const blob = await drawCard(`${pool!.name} · ${season.name}`, title, recap!.lines, recap!.table, sponsor?.display_name ?? null);
    if (sponsor) sponsorEvent(sponsor.booking_id, "share");
    const file = new File([blob], `scrumline-round-${recap!.round}.png`, { type: "image/png" });
    const text = `${title}, ${pool!.name}\n` + recap!.lines.map((l) => `${l.label}: ${l.text}`).join("\n");
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text }); return; }
    } catch (e) { if ((e as Error).name === "AbortError") return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
    URL.revokeObjectURL(a.href);
    setNote("Saved the image. Drop it in the group chat.");
  }

  return (
    <div className="recap">
      <div className="recaphead">
        <h3>{title}</h3>
        <button type="button" className="bank" onClick={share}>Share</button>
      </div>
      <dl>
        {recap.lines.map((l) => <div key={l.label}><dt>{l.label}</dt><dd>{l.text}</dd></div>)}
      </dl>
      {note && <p className="small muted" style={{ margin: "6px 0 0" }}>{note}</p>}
    </div>
  );
}

// The recap as a 1080x1350 image, in the app's colours, for WhatsApp and friends.
async function drawCard(sub: string, title: string, lines: Line[], table: { name: string; pts: number; rank: number }[], sponsor: string | null): Promise<Blob> {
  const W = 1080, H = 1350, pad = 80;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0d1412"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#1d6f4d"; g.fillRect(0, 0, W, 14);
  const font = (w: number, px: number) => `${w} ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  g.fillStyle = "#e8f0ec"; g.font = font(800, 44); g.fillText("SCRUMLINE", pad, 120);
  g.fillStyle = "#e0b23c"; g.font = font(700, 22); g.fillText("RUGBY PREDICTION LEAGUES", pad, 158);
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
  // The pool table after this round, as much of it as fits.
  g.strokeStyle = "#24382f"; g.lineWidth = 2;
  for (const t of table) {
    if (y + 20 > H - (sponsor ? 140 : 60)) break;
    g.beginPath(); g.moveTo(pad, y - 44); g.lineTo(W - pad, y - 44); g.stroke();
    g.fillStyle = "#8aa79a"; g.font = font(600, 32); g.fillText(String(t.rank), pad, y);
    g.fillStyle = "#e8f0ec"; g.fillText(t.name, pad + 60, y);
    g.font = font(800, 32); g.textAlign = "right"; g.fillText(String(t.pts), W - pad, y); g.textAlign = "left";
    y += 62;
  }
  // The sponsor's footer: one quiet line, like the one in the app.
  if (sponsor) {
    g.fillStyle = "#131e1b"; g.fillRect(0, H - 100, W, 100);
    g.fillStyle = "#8aa79a"; g.font = font(500, 28); g.fillText("Prizes by ", pad, H - 40);
    const x = pad + g.measureText("Prizes by ").width;
    g.fillStyle = "#e8f0ec"; g.font = font(700, 28); g.fillText(sponsor, x, H - 40);
    g.fillStyle = "#8aa79a"; g.font = font(600, 24); g.textAlign = "right"; g.fillText("scrumline", W - pad, H - 40); g.textAlign = "left";
  }
  return new Promise((ok) => c.toBlob((b) => ok(b!), "image/png"));
}
