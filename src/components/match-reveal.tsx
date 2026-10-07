"use client";

import { useEffect, useState } from "react";
import { readCache, writeCache } from "@/lib/cache";
import { splitLines, type RevealCall } from "@/lib/moments";
import { supabase } from "@/lib/supabase";
import type { Member, Team } from "@/lib/types";

interface Game { id: string; home_team_id: string; away_team_id: string; home_score: number | null; away_score: number | null }
interface Call extends RevealCall { user_id: string; is_banker: boolean; pts: number | null }
interface Reveal { game: Game; calls: Call[] }

/**
 * A game has kicked off, so the league's calls are locked: the chat shows how
 * everyone called it, and the points once it's finished. Only locked calls
 * come back from the database, so this can never show a call still open.
 */
export function MatchReveal({ matchId, me, people, inLeague, teams }: {
  matchId: string; me: string; people: Map<string, Member>; inLeague: Set<string>; teams: Map<string, Team>;
}) {
  const key = `reveal:${matchId}`;
  const [r, setR] = useState<Reveal | null>(() => readCache<Reveal>(key) ?? null);

  useEffect(() => {
    let live = true;
    (async () => {
      const [g, calls, scores] = await Promise.all([
        supabase.from("matches").select("id, home_team_id, away_team_id, home_score, away_score").eq("id", matchId).maybeSingle(),
        supabase.from("predictions").select("entry_id, home_score, away_score, is_banker").eq("match_id", matchId),
        supabase.from("prediction_scores").select("entry_id, total_pts").eq("match_id", matchId),
      ]);
      const rows = (calls.data ?? []) as { entry_id: number; home_score: number; away_score: number; is_banker: boolean }[];
      if (!g.data || !rows.length) return;
      const { data: es } = await supabase.from("entries").select("id, user_id").in("id", rows.map((x) => x.entry_id));
      const owner = new Map(((es ?? []) as { id: number; user_id: string }[]).map((e) => [e.id, e.user_id]));
      const pts = new Map(((scores.data ?? []) as { entry_id: number; total_pts: number }[]).map((x) => [x.entry_id, x.total_pts]));
      const out: Call[] = rows.map((x) => {
        const u = owner.get(x.entry_id) ?? "";
        return { ...x, user_id: u, me: u === me, name: u === me ? "You" : people.get(u)?.display_name ?? "A mate", pts: pts.get(x.entry_id) ?? null };
      }).sort((a, b) => (b.pts ?? 0) - (a.pts ?? 0) || Number(b.me) - Number(a.me) || a.name.localeCompare(b.name));
      const next = { game: g.data as Game, calls: out };
      if (!live) return;
      writeCache(key, next); setR(next);
    })();
    return () => { live = false; };
  }, [matchId, me, people, key]);

  // Only this league's players: the same game can be revealed in each of your leagues.
  const calls = r?.calls.filter((c) => inLeague.has(c.user_id)) ?? [];
  if (!r || calls.length < 2) return null;
  const home = teams.get(r.game.home_team_id)?.display_name ?? "Home";
  const away = teams.get(r.game.away_team_id)?.display_name ?? "Away";
  const done = r.game.home_score !== null;
  const { split, lone } = splitLines(calls, home, away);
  const best = done ? Math.max(...calls.map((c) => c.pts ?? 0)) : 0;
  return (
    <div className="notice reveal" role="status">
      <span className="nk">{done ? "Full time" : "Kickoff"}</span>
      <strong>{done ? `${home} ${r.game.home_score}–${r.game.away_score} ${away}` : `${home} v ${away}`}</strong>
      <span className="nsub">{split}{lone && <> {lone}</>}</span>
      <ul className="reveal-calls">
        {calls.map((c) => (
          <li key={c.user_id} className={c.me ? "me" : ""}>
            <span>{c.name}{c.is_banker && <span className="pchip bank2">×2</span>}</span>
            <strong>{c.home_score}–{c.away_score}</strong>
            {done && <span className={`pts${best > 0 && c.pts === best ? " top" : ""}`}>+{c.pts ?? 0}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
