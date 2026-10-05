import type { Match } from "@/lib/types";

export interface Streak { rounds: number; forgiven: boolean }

/**
 * Rounds in a row you've called at least one game in, counting back from the
 * latest finished round. Forgiving: one missed round doesn't break it (the
 * "free miss"), a second does. A round still being played only counts once
 * you've called in it, and rounds before your first call never count against you.
 */
export function callingStreak(matches: Match[], calledIds: Set<string>, now = Date.now()): Streak {
  const byRound = new Map<number, Match[]>();
  for (const m of matches) byRound.set(m.round, [...(byRound.get(m.round) ?? []), m]);
  const called = (r: number) => (byRound.get(r) ?? []).some((m) => calledIds.has(m.id));
  const started = [...byRound.keys()]
    .filter((r) => byRound.get(r)!.some((m) => new Date(m.kickoff_at).getTime() <= now))
    .sort((a, b) => b - a);
  const first = started.filter(called).at(-1);
  if (first === undefined) return { rounds: 0, forgiven: false };

  let rounds = 0;
  let forgiven = false;
  for (const r of started) {
    if (r < first) break;
    const finished = byRound.get(r)!.every((m) => m.home_score !== null || ["FT", "INTR", "POSTP"].includes(m.status));
    if (called(r)) { rounds += 1; continue; }
    if (!finished) continue; // still on: no miss yet
    if (forgiven) break;
    forgiven = true;
  }
  return { rounds, forgiven };
}
