"use client";

import type { Match } from "@/lib/types";
import { matchDay, roundName } from "@/lib/format";

/**
 * One round at a time: arrows either side, and the round name opens a list
 * of every round with its dates. Eighteen chips in a row was too much.
 */
export function RoundPicker({ rounds, round, onPick, locked, matches }: {
  rounds: number[]; round: number; onPick: (r: number) => void; locked?: Set<number>; matches: Match[];
}) {
  const i = rounds.indexOf(round);
  const dates = (r: number) => {
    const ks = matches.filter((m) => m.round === r).map((m) => m.kickoff_at).sort();
    if (!ks.length) return "";
    const a = matchDay(ks[0]), b = matchDay(ks[ks.length - 1]);
    return a === b ? a : `${a} to ${b}`;
  };
  return (
    <div className="stepper">
      <button type="button" className="ghost arrow" aria-label="Previous round" disabled={i <= 0} onClick={() => onPick(rounds[i - 1])}>‹</button>
      <label className="which">
        <select value={round} onChange={(e) => onPick(Number(e.target.value))} aria-label="Round">
          {rounds.map((r) => <option key={r} value={r}>{roundName(r)}{locked?.has(r) ? " ✓" : ""} · {dates(r)}</option>)}
        </select>
        <strong>{roundName(round)}{locked?.has(round) ? " ✓" : ""}</strong>
        <span>{dates(round)} · {rounds.length} round{rounds.length === 1 ? "" : "s"} ▾</span>
      </label>
      <button type="button" className="ghost arrow" aria-label="Next round" disabled={i >= rounds.length - 1} onClick={() => onPick(rounds[i + 1])}>›</button>
    </div>
  );
}

/** The round with the next match still to be played, else the last round. */
export function currentRound(rounds: number[], matches: Match[]): number {
  const now = Date.now();
  const next = matches.find((m) => m.home_score === null && new Date(m.kickoff_at).getTime() > now - 3 * 3600_000);
  return next?.round ?? rounds[rounds.length - 1] ?? 1;
}
