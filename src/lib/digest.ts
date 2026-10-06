/**
 * The round at a glance: which of this round's games will move the table
 * between you and your pool, and where you stand going into them. Built only
 * from calls you can already see (the database hides mates' calls until both
 * are locked), so it never gives anything away.
 *
 * It talks in counts, not names, so it reads the same with 2 mates or 20.
 */

export interface DigestCall { entry_id: number; match_id: string; home_score: number; away_score: number; is_banker: boolean }
export interface DigestMate extends DigestCall { name: string }
export interface DigestMatch { id: string; home: string; away: string; finished: boolean }
export interface DigestRow { entry_id: number | null; manager: string; total_points: number }

export type Side = "home" | "draw" | "away";
export type Kind = "lone" | "against" | "split" | "with";

export interface SwingGame {
  match_id: string;
  kind: Kind;
  label: string;                       // "Lone call", "Against the league", or "" for an ordinary split
  mine: Side;
  counts: Record<Side, number>;        // the whole pool's calls, you included
  text: string;                        // one line on who's where
  bankers: string[];                   // "Your Banker", "Reeves' Banker", "3 Bankers against you"
  stake: number;                       // result points you bank that the mates against you don't, if you're right
}

export interface Digest {
  headline: string;
  standing: string | null;
  swings: SwingGame[];                 // the top few, boldest first
  moreSwings: number;                  // swing games not shown
  agreed: number;                      // games where every mate backs your winner
  bold: number;                        // swing games where you're alone or in the minority
  stake: number;                       // total over every swing game
}

const side = (c: { home_score: number; away_score: number }): Side =>
  c.home_score > c.away_score ? "home" : c.home_score < c.away_score ? "away" : "draw";
const poss = (n: string) => (n.endsWith("s") ? `${n}'` : `${n}'s`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ord = (n: number) => {
  const t = n % 100, u = n % 10;
  return `${n}${t >= 11 && t <= 13 ? "th" : u === 1 ? "st" : u === 2 ? "nd" : u === 3 ? "rd" : "th"}`;
};
const RANK: Record<Kind, number> = { lone: 4, against: 3, split: 2, with: 1 };
const LABEL: Record<Kind, string> = { lone: "Lone call", against: "Against the league", split: "", with: "" };

export function buildDigest(opts: {
  myEntry: number;
  mine: DigestCall[];
  mates: DigestMate[];
  matches: DigestMatch[];
  table: DigestRow[];     // the pool's leaderboard; empty when you're in no pool
  poolName: string | null;
  top?: number;
}): Digest | null {
  const { myEntry, mine, mates, matches, table, poolName, top = 3 } = opts;
  const games: SwingGame[] = [];
  let agreed = 0;
  for (const m of matches) {
    if (m.finished) continue;
    const me = mine.find((c) => c.match_id === m.id);
    const theirs = mates.filter((c) => c.match_id === m.id);
    if (!me || !theirs.length) continue;
    const my = side(me);
    const against = theirs.filter((c) => side(c) !== my);
    if (!against.length) { agreed++; continue; }
    const withMe = theirs.filter((c) => side(c) === my);
    const counts: Record<Side, number> = { home: 0, draw: 0, away: 0 };
    for (const c of [me, ...theirs]) counts[side(c)]++;
    const us = withMe.length + 1, them = against.length;
    const kind: Kind = withMe.length === 0 ? "lone"
      : us < them && Math.abs(us - them) > Math.max(1, Math.round(theirs.length / 5)) ? "against"
      : Math.abs(us - them) <= Math.max(1, Math.round(theirs.length / 5)) ? "split" : "with";
    const name = (x: Side) => (x === "home" ? m.home : x === "away" ? m.away : "the draw");
    // Names while they fit, counts after that: "You and Max on Cardiff · 8 on Scarlets".
    const group = (xs: DigestMate[]) => (xs.length <= 2 ? xs.map((c) => c.name).join(" and ") : String(xs.length));
    const yours = withMe.length === 0 ? `Just you on ${name(my)}`
      : withMe.length === 1 ? `You and ${withMe[0].name} on ${name(my)}`
      : withMe.length === 2 ? `You, ${withMe[0].name} and ${withMe[1].name} on ${name(my)}`
      : `You and ${withMe.length} mates on ${name(my)}`;
    const others = (["home", "draw", "away"] as Side[]).filter((x) => x !== my)
      .map((x) => against.filter((c) => side(c) === x)).filter((xs) => xs.length)
      .map((xs) => `${group(xs)} on ${name(side(xs[0]))}`);
    const text = [yours, ...others].join(" · ");
    const theirBankers = against.filter((c) => c.is_banker);
    const bankers = [
      ...(me.is_banker ? ["Your Banker"] : []),
      ...(theirBankers.length === 1 ? [`${poss(theirBankers[0].name)} Banker`]
        : theirBankers.length ? [`${theirBankers.length} Bankers against`] : []),
    ];
    // The 6 for the right result is yours and not theirs, doubled on your Banker.
    games.push({ match_id: m.id, kind, label: LABEL[kind], mine: my, counts, text, bankers, stake: 6 * (me.is_banker ? 2 : 1) });
  }
  if (!games.length && !agreed) return null;
  games.sort((a, b) => RANK[b.kind] - RANK[a.kind] || b.bankers.length - a.bankers.length);
  const bold = games.filter((g) => g.kind === "lone" || g.kind === "against").length;
  const stake = games.reduce((a, g) => a + g.stake, 0);

  // Where you stand, once anyone has a point on the board.
  let standing: string | null = null;
  const rows = table.filter((r) => r.entry_id !== null);
  const meRow = rows.find((r) => r.entry_id === myEntry);
  const played = rows.some((r) => r.total_points > 0);
  if (meRow && rows.length > 1 && poolName && played) {
    const ahead = rows.filter((r) => r.total_points > meRow.total_points);
    const level = rows.filter((r) => r.entry_id !== myEntry && r.total_points === meRow.total_points);
    const pts = plural(meRow.total_points, "pt");
    if (!ahead.length && !level.length) {
      const next = Math.max(...rows.filter((r) => r.entry_id !== myEntry).map((r) => r.total_points));
      standing = `You lead ${poolName} on ${pts}, ${meRow.total_points - next} clear.`;
    } else if (!ahead.length) {
      standing = `You're level at the top of ${poolName} on ${pts}${level.length <= 2 ? ` with ${level.map((r) => r.manager).join(" and ")}` : ` with ${level.length} others`}.`;
    } else {
      const leader = Math.max(...ahead.map((r) => r.total_points));
      standing = `You're ${level.length ? "joint " : ""}${ord(ahead.length + 1)} of ${rows.length} in ${poolName} on ${pts}, ${leader - meRow.total_points} off the top.`;
    }
  }

  const headline = !games.length
    ? "You're with the whole league on every game so far. Margins will decide it."
    : !played
      ? `Everyone starts on 0. ${bold ? `Your ${plural(bold, "bold call")} ${bold === 1 ? "is" : "are"} where you break away.` : "These splits are where it opens up."}`
      : bold ? `${plural(bold, "bold call")} this round. Get ${bold === 1 ? "it" : "them"} right and you pull away.`
        : "You're mostly with the league, so a few splits decide it.";

  return { headline, standing, bold, swings: games.slice(0, top), moreSwings: Math.max(0, games.length - top), agreed, stake };
}
