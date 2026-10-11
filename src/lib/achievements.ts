import type { Match } from "@/lib/types";

/** One scored call, as stored in prediction_points. */
export interface ScoredCall { round: number; right_result: boolean; near_pts: number; exact_pts: number; is_banker: boolean }

export interface Achievement {
  key: string;
  title: string;
  rule: string;
  /** Progress toward the goal, never above `goal`. */
  have: number;
  goal: number;
  /** Plain words for where you are, e.g. "Best round: 5 of 8". */
  note: string;
  earned: boolean;
}

const perRound = (calls: ScoredCall[], pick: (c: ScoredCall) => boolean) => {
  const out = new Map<number, number>();
  for (const c of calls) out.set(c.round, (out.get(c.round) ?? 0) + (pick(c) ? 1 : 0));
  return out;
};

/**
 * The four calling achievements, worked out from your scored calls. Recognition only:
 * nothing here changes points or rankings.
 */
export function achievements(calls: ScoredCall[], matches: Match[]): Achievement[] {
  const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
  const games = new Map<number, number>();
  for (const m of matches) games.set(m.round, (games.get(m.round) ?? 0) + 1);

  // Sharpshooter: the most exact scores inside any 3 rounds in a row.
  const exact = perRound(calls, (c) => c.exact_pts > 0);
  let sharp = 0;
  for (let i = 0; i < rounds.length; i++) {
    const n = rounds.slice(i, i + 3).reduce((s, r) => s + (exact.get(r) ?? 0), 0);
    sharp = Math.max(sharp, n);
  }

  // Clean sweep: the right winner in every game of one round.
  const right = perRound(calls, (c) => c.right_result);
  const scored = perRound(calls, () => true);
  let sweepBest = 0, sweepOf = 0, swept = false;
  for (const [r, n] of right) {
    const total = games.get(r) ?? 0;
    if (total > 0 && n === total && scored.get(r) === total) swept = true;
    if (n > sweepBest || (n === sweepBest && total < sweepOf)) { sweepBest = n; sweepOf = total; }
  }

  // Dead-on: five games in one round within 3 points of the real score for both teams.
  const dead = perRound(calls, (c) => c.near_pts >= 4);
  const deadBest = Math.max(0, ...dead.values());

  const banker = calls.some((c) => c.is_banker && c.exact_pts > 0);

  return [
    { key: "sharpshooter", title: "Sharpshooter", rule: "Call 3 exact scores within 3 rounds in a row.",
      have: Math.min(3, sharp), goal: 3, note: `${Math.min(3, sharp)} of 3 exact scores`, earned: sharp >= 3 },
    { key: "clean-sweep", title: "Clean sweep", rule: "Pick the winner in every game of a round.",
      have: swept ? 1 : 0, goal: 1, note: sweepOf ? `Best round: ${sweepBest} of ${sweepOf} winners` : "No scored rounds yet", earned: swept },
    { key: "banker-bang", title: "Banker bang", rule: "Your Banker lands an exact score.",
      have: banker ? 1 : 0, goal: 1, note: banker ? "Landed" : "Not yet", earned: banker },
    { key: "dead-on", title: "Dead-on", rule: "Get 5 games in one round within 3 points for both teams.",
      have: Math.min(5, deadBest), goal: 5, note: `Best round: ${Math.min(5, deadBest)} of 5`, earned: deadBest >= 5 },
  ];
}
