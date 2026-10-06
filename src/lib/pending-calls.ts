import { isRugbyScore } from "./rugby";

/**
 * Calls made on an invite link before signing up. They wait on this device
 * until the newcomer has a team in that tournament, then go in as ordinary
 * calls for any game that hasn't kicked off. Kept apart from the "sl:" cache
 * so signing out (or in) doesn't wipe them on the way.
 */
const KEY = "scrumline:pending-calls";

export type PendingCalls = { season: string; calls: Record<string, [number, number]>; kickoffs: Record<string, string> };

export function readPendingCalls(): PendingCalls | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PendingCalls) : null;
  } catch { return null; }
}

export function writePendingCalls(p: PendingCalls | null): void {
  try {
    if (!p || !Object.keys(p.calls).length) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(p));
  } catch { /* storage blocked: the calls just aren't kept */ }
}

/** The calls still worth saving for a tournament: real rugby scores for games that haven't started. */
export function callsToSave(p: PendingCalls | null, season: string, now = Date.now()): { match_id: string; home_score: number; away_score: number }[] {
  if (!p || p.season !== season) return [];
  return Object.entries(p.calls)
    .filter(([id, [h, a]]) => isRugbyScore(h) && isRugbyScore(a) && new Date(p.kickoffs[id] ?? 0).getTime() > now)
    .map(([match_id, [home_score, away_score]]) => ({ match_id, home_score, away_score }));
}
