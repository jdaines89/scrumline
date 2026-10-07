/** Growth sprint helpers: the words on the bring-a-mate card and the organiser's nudge. */

export interface AfterRound { round: number; pts: number; pool_id: number | null; pool_name: string | null; join_code: string | null; members: number | null; rank: number; of: number }
export interface OrganiserRow { round: number; first_ko: string; games: number; user_id: string; display_name: string; called: number }

export const ord = (n: number) => {
  const t = n % 100, u = n % 10;
  return `${n}${t >= 11 && t <= 13 ? "th" : u === 1 ? "st" : u === 2 ? "nd" : u === 3 ? "rd" : "th"}`;
};

/** "You scored 14, 2nd of 4 in The Originals." Joint places read as joint. */
export function afterRoundLine(a: AfterRound, roundLabel: string): string {
  const scored = `${roundLabel}: you scored ${a.pts}`;
  if (!a.pool_name || a.of < 2) return `${scored}.`;
  return `${scored}, ${ord(a.rank)} of ${a.of} in ${a.pool_name}.`;
}

/** A small league gets asked for one more; a bigger one for the next rival. */
export function mateAsk(members: number | null): string {
  if (!members || members < 4) return "It's more fun with a few more of you. Who should be in it next weekend?";
  if (members < 8) return "Who else would you love to beat? One more player makes every round closer.";
  return "Who's the next rival? Every new player makes the table harder to top.";
}

/** Names, written the way people say them: "Reeves", "Reeves and Elsa", "Reeves, Elsa and 2 more". */
export function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** Who still has games to call before the next round starts. */
export function stillToCall(rows: OrganiserRow[], me: string): OrganiserRow[] {
  return rows.filter((r) => r.user_id !== me && r.called < r.games);
}
