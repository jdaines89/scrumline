/** One locked call, as the kickoff reveal and the mates' list show it. */
export interface RevealCall { name: string; home_score: number; away_score: number; me?: boolean }

const plural = (n: number) => (n === 1 ? "1 backs" : `${n} back`);

/** "the Stormers", "the Bulls", but plain "Connacht", "South Africa", "Wales": only one-word plural names take "the". */
export function teamRef(name: string): string {
  return /^[A-Z][a-z]+s$/.test(name) && name !== "Wales" ? `the ${name}` : name;
}

/**
 * How a league called a game, in a line: "3 back the Stormers, 1 the Bulls."
 * and, when one person stands alone against the rest, a second line naming them.
 * Only ever about calls already locked, so it never steers anyone's own call.
 */
export function splitLines(calls: RevealCall[], home: string, away: string): { split: string; lone: string | null } {
  const h = calls.filter((c) => c.home_score > c.away_score);
  const a = calls.filter((c) => c.home_score < c.away_score);
  const d = calls.filter((c) => c.home_score === c.away_score);
  const parts = [
    h.length ? [h.length, home] as const : null,
    a.length ? [a.length, away] as const : null,
  ].filter((x): x is readonly [number, string] => !!x).sort((x, y) => y[0] - x[0]);
  let split = !parts.length ? "" : parts.length === 1 && parts[0][0] === calls.length && calls.length > 1
    ? `Everyone backs ${teamRef(parts[0][1])}.`
    : `${plural(parts[0][0])} ${teamRef(parts[0][1])}${parts[1] ? `, ${parts[1][0]} ${teamRef(parts[1][1])}` : ""}.`;
  if (d.length) split = `${split}${split ? " " : ""}${d.length === 1 ? "1 calls" : `${d.length} call`} a draw.`;

  let lone: string | null = null;
  const alone = (side: RevealCall[], others: RevealCall[], team: string) => {
    if (side.length !== 1 || others.length < 2) return;
    lone = side[0].me ? `You're the only one backing ${teamRef(team)}.` : `${side[0].name} is the only one backing ${teamRef(team)}.`;
  };
  alone(h, [...a, ...d], home);
  alone(a, [...h, ...d], away);
  return { split, lone };
}

/** Your full time, as my_full_time() returns it: the games you called that finished lately, and your league after them. */
export interface FullTime {
  season: string;
  matches: { match_id: string; home: string; away: string; home_score: number; away_score: number; pred_home: number; pred_away: number; pts: number; exact: boolean; banker: boolean }[];
  league: { pool_id: number; name: string; of: number; rank_now: number; rank_before: number; passed: string[] } | null;
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${s}`;
}

/** "Up to 2nd in The Originals, past Pieter." The same words as the full-time push. */
export function placeLine(l: NonNullable<FullTime["league"]>): string {
  const at = `${ordinal(l.rank_now)} in ${l.name}`;
  if (l.rank_now < l.rank_before) {
    const past = l.passed.length === 1 ? `, past ${l.passed[0]}` : l.passed.length > 1 ? `, past ${l.passed.length} players` : "";
    return `Up to ${at}${past}.`;
  }
  if (l.rank_now > l.rank_before) return `Down to ${at}.`;
  return `Still ${at}.`;
}

/** A kickoff reveal as the chat loads it: one per league and game. */
export interface RevealRow { id: number; match_id: string; created_at: string }

/** The South African day a reveal falls on, so a weekend's games share one card a day. */
export const revealDay = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

/**
 * One card per match day instead of one per game, so a busy weekend adds a card or two
 * to a league's chat, not eight. The card sits where the day's first game kicked off.
 */
export function groupReveals(rows: RevealRow[]): { id: number; created_at: string; match_ids: string[] }[] {
  const days = new Map<string, RevealRow[]>();
  for (const r of [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id)) {
    const k = revealDay(r.created_at);
    days.set(k, [...(days.get(k) ?? []), r]);
  }
  return [...days.values()].map((rs) => ({ id: rs[0].id, created_at: rs[0].created_at, match_ids: [...new Set(rs.map((r) => r.match_id))] }));
}
