export function kickoff(iso: string): string {
  // Kickoffs are stored in UTC; the competition is played in SAST (UTC+2).
  const d = new Date(iso);
  return d.toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export function matchDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-ZA", {
    timeZone: "Africa/Johannesburg", day: "numeric", month: "short",
  });
}

export function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export function pts(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "");
}

// TheSportsDB numbers knockout rounds 125 (quarter-finals), 150 (semi-finals),
// 160 (third-place play-off) and 200 (final); league rounds are 1, 2, 3...
const KNOCKOUT: Record<number, [string, string, string]> = {
  125: ["Quarter-finals", "the quarter-finals", "QF"],
  150: ["Semi-finals", "the semi-finals", "SF"],
  160: ["Third-place play-off", "the third-place play-off", "3rd"],
  200: ["Final", "the final", "F"],
};
/** "Round 5", or "Quarter-finals", "Semi-finals", "Final". */
export const roundName = (r: number | null | undefined) => KNOCKOUT[r ?? 0]?.[0] ?? `Round ${r}`;
/** The same mid-sentence: "round 5", "the final". */
export const roundText = (r: number | null | undefined) => KNOCKOUT[r ?? 0]?.[1] ?? `round ${r}`;
/** Tight spaces: "R5", "QF", "F". */
export const roundShort = (r: number | null | undefined) => KNOCKOUT[r ?? 0]?.[2] ?? `R${r}`;
