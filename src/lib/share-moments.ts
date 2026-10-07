import { roundName } from "./format";
import { teamRef } from "./moments";

/** my_share_moments(): your moments from the last day and a half. Other players only ever appear as counts. */
export interface Moments {
  round: number | null;
  exact: { match_id: string; home: string; away: string; home_score: number; away_score: number; callers: number; same: number }[];
  lone: { match_id: string; home: string; away: string; home_score: number; away_score: number; winner: string; league: string; callers: number }[];
  round_top: { league: string; callers: number; pts: number; joint: boolean } | null;
  class_lead: { school: string; school_year: number; ranked: number } | null;
}

/** One picture's words: a small heading, the big line, and the line that says why it matters. */
export interface Moment {
  kind: string; kicker: string; headline: string; detail: string; said: string;
  /** A finished game, drawn as a scoreboard on the picture instead of the headline. */
  score?: { home: string; away: string; home_score: number; away_score: number };
}

/** The best moment to share, if any: an exact call beats a lone call, which beats a round win, which beats your class. */
export function bestMoment(m: Moments | null): Moment | null {
  if (!m) return null;
  const e = m.exact?.[0];
  if (e) return {
    kind: "exact", kicker: "Spot on",
    headline: `${e.home} ${e.home_score}–${e.away_score} ${e.away}`,
    score: { home: e.home, away: e.away, home_score: e.home_score, away_score: e.away_score },
    detail: e.same <= 1 ? `I called it exactly, the only one of ${fmt(e.callers)} who did.` : `I called it exactly. Only ${fmt(e.same)} of ${fmt(e.callers)} did.`,
    said: e.same <= 1 ? `You were the only one of ${fmt(e.callers)} to call ${e.home} v ${e.away} exactly.` : `Only ${fmt(e.same)} of ${fmt(e.callers)} called ${e.home} v ${e.away} exactly.`,
  };
  const l = m.lone?.[0];
  if (l) return {
    kind: "lone", kicker: "Called it",
    headline: `${l.home} ${l.home_score}–${l.away_score} ${l.away}`,
    score: { home: l.home, away: l.away, home_score: l.home_score, away_score: l.away_score },
    detail: `I was the only one of ${l.callers} in ${l.league} to back ${teamRef(l.winner)}.`,
    said: `You were the only one of ${l.callers} in ${l.league} to back ${teamRef(l.winner)}.`,
  };
  const t = m.round_top;
  if (t && m.round) return {
    kind: "round_top", kicker: `${t.joint ? "Joint top" : "Top"} of ${roundName(m.round)}`,
    headline: t.league,
    detail: `${t.pts} points, ${t.joint ? "joint best" : "the best"} of ${t.callers} players this round.`,
    said: `${t.pts} points, ${t.joint ? "joint best" : "the best"} of ${t.callers} in ${t.league}.`,
  };
  const c = m.class_lead;
  if (c) return {
    kind: "class_lead", kicker: "Top class",
    headline: `Class of ${c.school_year}`,
    detail: `Leading ${c.school}, 1st of ${c.ranked} class years.`,
    said: `Your class leads ${c.school}, 1st of ${c.ranked} class years.`,
  };
  return null;
}

const fmt = (n: number) => n.toLocaleString("en-ZA");
