/** One player's Bok days line: Springbok tests only, without the Banker. */
export interface BokDaysRow {
  league_id: number; year: number; user_id: string; display_name: string;
  points: number; tests_called: number; right_results: number; exact_scores: number;
}

/** This year in South Africa, which is the year the Bok days table runs for. */
export function bokYear(now: Date = new Date()): number {
  return Number(now.toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg", year: "numeric" }));
}

/** Most points first, then exact scores, then fewer tests called (same points from fewer games), then name. */
export function rankBokDays(rows: BokDaysRow[]): BokDaysRow[] {
  return [...rows].sort((a, b) => Number(b.points) - Number(a.points) || Number(b.exact_scores) - Number(a.exact_scores)
    || Number(a.tests_called) - Number(b.tests_called) || a.display_name.localeCompare(b.display_name));
}
