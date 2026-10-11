import { describe, expect, it } from "vitest";
import { bokYear, rankBokDays, type BokDaysRow } from "../src/lib/bok-days";

const row = (user_id: string, points: number, exact = 0, tests = 1): BokDaysRow => ({
  league_id: 1, year: 2026, user_id, display_name: user_id, points, tests_called: tests, right_results: 0, exact_scores: exact,
});

describe("Bok days", () => {
  it("ranks by points, then exact scores, then fewer tests called", () => {
    const r = rankBokDays([row("a", 10, 0, 2), row("b", 12), row("c", 10, 1, 2), row("d", 10, 0, 1)]);
    expect(r.map((x) => x.user_id)).toEqual(["b", "c", "d", "a"]);
  });
  it("uses the year in South Africa", () => {
    expect(bokYear(new Date("2026-12-31T22:30:00Z"))).toBe(2027);
  });
});
