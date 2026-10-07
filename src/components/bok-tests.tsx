"use client";

import { useEffect, useState } from "react";
import { useLeague } from "@/components/league";
import { poolTitle } from "@/components/pool-name";
import { BOKS, bokInvite, opponents, testsAhead, type BokTest } from "@/lib/bok-tests";
import { readCache, writeCache } from "@/lib/cache";
import { dayHeading, kickTime } from "@/lib/format";
import { logEvent } from "@/lib/events";
import { joinLink } from "@/lib/join-link";
import { supabase } from "@/lib/supabase";
import type { Team } from "@/lib/types";

const hidden = (season: string) => `sl:bok-card:${season}`;

/**
 * The November tests are what brings non-URC fans in: the Boks' fixtures, and
 * one tap to send a mates' league to a group chat, as a message or a picture.
 * Shown until the last Bok test kicks off, or until "Not now".
 */
export function BokTests() {
  const { seasons, teams, pools, pool, setSeason } = useLeague();
  const [tests, setTests] = useState<BokTest[]>(() => readCache<BokTest[]>("bok-tests") ?? []);
  const [code, setCode] = useState<string | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [off, setOff] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const live = seasons.filter((s) => !s.is_replay).map((s) => s.id).join(",");

  useEffect(() => {
    if (!live) return;
    supabase.from("matches").select("id, season, kickoff_at, home_team_id, away_team_id, venue")
      .in("season", live.split(",")).or(`home_team_id.eq.${BOKS},away_team_id.eq.${BOKS}`)
      .gt("kickoff_at", new Date().toISOString()).order("kickoff_at")
      .then(({ data }) => { const r = (data ?? []) as BokTest[]; writeCache("bok-tests", r); setTests(r); });
    supabase.rpc("my_invite").then(({ data }) => setCode(((data ?? []) as { code: string }[])[0]?.code ?? null));
  }, [live]);

  const ahead = testsAhead(tests, Date.now());
  const season = seasons.find((s) => s.id === ahead[0]?.season);
  useEffect(() => {
    if (!season) return;
    try { setOff(localStorage.getItem(hidden(season.id))); } catch { /* show it */ }
  }, [season]);
  if (!season || off) return null;

  // Your own mates' leagues: a code joins the whole league, so the tests come with it.
  const mates = pools.filter((p) => !p.school_emis);
  const league = mates.find((p) => p.id === pick) ?? mates.find((p) => p.id === pool?.id) ?? mates[0] ?? null;
  const site = `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}`;
  const link = joinLink(site, code, league?.join_code);
  const name = (id: string) => teams.get(id)?.display_name ?? "";
  const rival = (t: BokTest) => name(t.home_team_id === BOKS ? t.away_team_id : t.home_team_id);
  const text = bokInvite(opponents(ahead.map(rival)), season.name, league ? poolTitle(league) : null, link);

  function hide() {
    try { localStorage.setItem(hidden(season!.id), "1"); } catch { /* fine */ }
    setOff("1");
  }

  async function sharePicture() {
    setNote(null);
    const blob = await drawCard(season!.name, ahead, teams, league ? poolTitle(league) : null, league?.join_code ?? null);
    logEvent("invite_shared", { from: "bok_tests", via: "picture" }, league?.id);
    const file = new File([blob], "scrumline-bok-tests.png", { type: "image/png" });
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text }); return; }
    } catch (e) { if ((e as Error).name === "AbortError") return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
    URL.revokeObjectURL(a.href);
    setNote("Saved the picture. Send it with the WhatsApp message so they get the link too.");
  }

  return (
    <div className="card bok">
      <h2>Call the Boks&apos; tests with your league</h2>
      <p className="sub">The {season.name} brings the Springboks to Scrumline. Send your league to the group chat and call these with them.</p>
      <ul className="bok-list">
        {ahead.map((t) => (
          <li key={t.id}>
            <span className="bok-when">{dayHeading(t.kickoff_at)} · {kickTime(t.kickoff_at)}</span>
            <strong>{name(t.home_team_id)} v {name(t.away_team_id)}</strong>
            {t.venue && <span className="small muted">{t.venue}</span>}
          </li>
        ))}
      </ul>
      {mates.length > 1 && (
        <label className="bok-league">
          <span className="small muted">League to send</span>
          <select value={league?.id ?? ""} onChange={(e) => setPick(Number(e.target.value))}>
            {mates.map((p) => <option key={p.id} value={p.id}>{poolTitle(p)}</option>)}
          </select>
        </label>
      )}
      <a className="btn bok-send" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"
        onClick={() => logEvent("invite_shared", { from: "bok_tests", via: "whatsapp" }, league?.id)}>
        Send on WhatsApp
      </a>
      <div className="row bok-more">
        <button type="button" className="ghost" onClick={sharePicture}>Share a picture</button>
        <button type="button" className="ghost" onClick={() => setSeason(season.id)}>See all the tests</button>
      </div>
      <button type="button" className="linkish bok-hide" onClick={hide}>Not now</button>
      {note && <p className="small muted" style={{ margin: "8px 0 0" }}>{note}</p>}
    </div>
  );
}

// The tests as a 1080x1350 picture, in the app's colours, for a group chat or a status.
async function drawCard(seasonName: string, tests: BokTest[], teams: Map<string, Team>, league: string | null, joinCode: string | null): Promise<Blob> {
  const W = 1080, H = 1350, pad = 80;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const font = (w: number, px: number) => `${w} ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const fit = (text: string, w: number, px: number, max: number) => {
    // Full names always: shrink the type until the line fits rather than cutting it.
    let s = px; g.font = font(w, s);
    while (g.measureText(text).width > max && s > 24) { s -= 2; g.font = font(w, s); }
  };
  g.fillStyle = "#0d1412"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#1d6f4d"; g.fillRect(0, 0, W, 14);
  g.fillStyle = "#e8f0ec"; g.font = font(800, 44); g.fillText("SCRUMLINE", pad, 120);
  g.fillStyle = "#e0b23c"; g.font = font(700, 22); g.fillText("GET YOUR SCHOOL OVER THE LINE", pad, 158);
  g.fillStyle = "#e8f0ec"; fit("Call the Boks' tests", 800, 80, W - pad * 2); g.fillText("Call the Boks' tests", pad, 300);
  g.fillText("with us", pad, 390);
  g.fillStyle = "#8aa79a"; fit(seasonName, 500, 34, W - pad * 2); g.fillText(seasonName, pad, 450);

  let y = 560;
  g.strokeStyle = "#24382f"; g.lineWidth = 2;
  for (const t of tests.slice(0, 4)) {
    g.beginPath(); g.moveTo(pad, y - 64); g.lineTo(W - pad, y - 64); g.stroke();
    g.fillStyle = "#35c98a"; g.font = font(700, 26);
    g.fillText(`${dayHeading(t.kickoff_at)} · ${kickTime(t.kickoff_at)}`.toUpperCase(), pad, y);
    const line = `${teams.get(t.home_team_id)?.display_name ?? ""} v ${teams.get(t.away_team_id)?.display_name ?? ""}`;
    g.fillStyle = "#e8f0ec"; fit(line, 700, 50, W - pad * 2); g.fillText(line, pad, y + 62);
    if (t.venue) { g.fillStyle = "#8aa79a"; fit(t.venue, 500, 28, W - pad * 2); g.fillText(t.venue, pad, y + 106); }
    y += 196;
  }

  // The way in: the league and its code on a quiet band at the foot.
  const foot = 220;
  g.fillStyle = "#131e1b"; g.fillRect(0, H - foot, W, foot);
  g.fillStyle = "#e0b23c"; g.fillRect(0, H - foot, W, 4);
  if (league && joinCode) {
    g.fillStyle = "#8aa79a"; g.font = font(600, 26); g.fillText("JOIN OUR LEAGUE", pad, H - foot + 66);
    g.fillStyle = "#e8f0ec"; fit(league, 800, 46, W - pad * 2 - 300); g.fillText(league, pad, H - foot + 124);
    g.textAlign = "right";
    g.fillStyle = "#8aa79a"; g.font = font(600, 26); g.fillText("CODE", W - pad, H - foot + 66);
    g.fillStyle = "#e0b23c"; g.font = font(800, 46); g.fillText(joinCode, W - pad, H - foot + 124);
    g.textAlign = "left";
  } else {
    g.fillStyle = "#e8f0ec"; g.font = font(800, 46); g.fillText("Join me on Scrumline", pad, H - foot + 110);
  }
  g.fillStyle = "#8aa79a"; g.font = font(500, 28); g.fillText("Free to play, no betting.", pad, H - foot + 178);
  return new Promise((ok) => c.toBlob((b) => ok(b!), "image/png"));
}
