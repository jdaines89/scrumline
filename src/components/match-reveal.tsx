"use client";

import { useEffect, useState } from "react";

/** Past this many calls (a school league), the card shows the split and a few names, with the rest a tap away. */
const SHORT = 6;
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
export function MatchReveal({ matchId, me, people, inLeague, teams, nested = false }: {
  matchId: string; me: string; people: Map<string, Member>; inLeague: Set<string>; teams: Map<string, Team>;
  /** One game inside a match-day card: just the split and your own call until opened. */
  nested?: boolean;
}) {
  const key = `reveal:${matchId}`;
  const [r, setR] = useState<Reveal | null>(() => readCache<Reveal>(key) ?? null);
  const [all, setAll] = useState(false);

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
        return { ...x, user_id: u, me: u === me, name: u === me ? "You" : people.get(u)?.display_name ?? "A player", pts: pts.get(x.entry_id) ?? null };
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
  const side = (c: Call) => Math.sign(c.home_score - c.away_score);
  const n = { home: calls.filter((c) => side(c) > 0).length, draw: calls.filter((c) => side(c) === 0).length, away: calls.filter((c) => side(c) < 0).length };
  // A big league: at kickoff you and anyone standing alone; at full time the top three and you.
  const alone = [1, -1].map((x) => calls.filter((c) => side(c) === x)).find((g) => g.length === 1 && calls.length - 1 >= 2)?.[0];
  const few = all ? calls
    : nested ? calls.filter((c) => c.me)
    : calls.length <= SHORT ? calls
    : done ? calls.filter((c, i) => i < 3 || c.me)
    : calls.filter((c) => c.me || c === alone).concat(calls.filter((c) => !c.me && c !== alone).slice(0, Math.max(0, 3 - Number(calls.some((c) => c.me)) - Number(!!alone))));
  const rank = (c: Call) => 1 + calls.filter((x) => (x.pts ?? 0) > (c.pts ?? 0)).length;
  const title = done ? `${home} ${r.game.home_score}–${r.game.away_score} ${away}` : `${home} v ${away}`;
  const more = nested ? calls.length > few.length : calls.length > SHORT;
  return (
    <div className={nested ? "reveal-game" : "notice reveal"} role={nested ? undefined : "status"}>
      {nested
        ? <div className="reveal-head"><strong>{title}</strong><span className="nk">{done ? "Full time" : "Kicked off"}</span></div>
        : <><span className="nk">{done ? "Full time" : "Kickoff"}</span><strong>{title}</strong></>}
      <div className="reveal-bar" aria-hidden="true">
        {n.home > 0 && <span className="h" style={{ flexGrow: n.home }} />}
        {n.draw > 0 && <span className="d" style={{ flexGrow: n.draw }} />}
        {n.away > 0 && <span className="a" style={{ flexGrow: n.away }} />}
      </div>
      <span className="nsub">{split}{lone && <> {lone}</>}</span>
      {few.length > 0 && <ul className="reveal-calls">
        {few.map((c) => (
          <li key={c.user_id} className={c.me ? "me" : ""}>
            <span>{done && calls.length > SHORT && <span className="rk">{rank(c)}</span>}{c.name}{c.is_banker && <span className="pchip bank2">×2</span>}</span>
            <strong>{c.home_score}–{c.away_score}</strong>
            {done && <span className={`pts${best > 0 && c.pts === best ? " top" : ""}`}>+{c.pts ?? 0}</span>}
          </li>
        ))}
      </ul>}
      {(more || all) && (
        <button type="button" className="linkish reveal-all" onClick={() => setAll(!all)}>{all ? "Show fewer" : `See all ${calls.length} calls`}</button>
      )}
    </div>
  );
}

/** A day's games in one card, so a busy weekend doesn't bury a league's chat. */
export function MatchDay({ matchIds, at, ...rest }: {
  matchIds: string[]; at: string; me: string; people: Map<string, Member>; inLeague: Set<string>; teams: Map<string, Team>;
}) {
  if (matchIds.length === 1) return <MatchReveal matchId={matchIds[0]} {...rest} />;
  return (
    <div className="notice reveal match-day" role="status">
      <span className="nk">{new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", weekday: "long" }).format(new Date(at))}&apos;s games</span>
      {matchIds.map((id) => <MatchReveal key={id} matchId={id} nested {...rest} />)}
    </div>
  );
}
