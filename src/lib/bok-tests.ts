/** South Africa's team id in the feed: the Springboks in the November tests. */
export const BOKS = "137137";

export interface BokTest { id: string; season: string; kickoff_at: string; home_team_id: string; away_team_id: string; venue: string | null }

/** The Bok tests still to come, so the card shows from now until the last one kicks off. */
export function testsAhead(tests: BokTest[], now: number): BokTest[] {
  return tests.filter((t) => new Date(t.kickoff_at).getTime() > now)
    .sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at));
}

/** "Italy, France and Ireland", the Boks' opponents in order. */
export function opponents(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The WhatsApp message: who the Boks play, which league to join, and the one link that does it. */
export function bokInvite(rivals: string, seasonName: string, league: string | null, link: string): string {
  const where = league ? `There is a place saved for you in "${league}" on Scrumline.` : "There is a place saved for you on Scrumline.";
  return `${where} The Boks play ${rivals} in the ${seasonName} this November: call the score of every test. Every call builds something bigger than the game. Get our schools over the line.\n\nTap to join: ${link}`;
}
