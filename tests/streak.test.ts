import { describe, expect, it } from "vitest";
import { callingStreak } from "../src/lib/streak";
import type { Match } from "../src/lib/types";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const m = (id: string, round: number, daysAgo: number, played = daysAgo > 0): Match => ({
  id, season: "s", round, kickoff_at: new Date(NOW - daysAgo * 864e5).toISOString(),
  home_team_id: "a", away_team_id: "b", home_score: played ? 20 : null, away_score: played ? 10 : null,
  venue: null, status: played ? "FT" : "SCHEDULED",
});
// Rounds 1-4 played a week apart, round 5 next week.
const season = [m("1a", 1, 28), m("1b", 1, 27), m("2a", 2, 21), m("3a", 3, 14), m("4a", 4, 7), m("5a", 5, -7)];

describe("callingStreak", () => {
  it("counts rounds in a row with at least one call", () => {
    expect(callingStreak(season, new Set(["1b", "2a", "3a", "4a"]), NOW)).toEqual({ rounds: 4, forgiven: false });
  });
  it("forgives one missed round", () => {
    expect(callingStreak(season, new Set(["1a", "2a", "4a"]), NOW)).toEqual({ rounds: 3, forgiven: true });
  });
  it("a second miss ends it", () => {
    expect(callingStreak(season, new Set(["1a", "4a"]), NOW)).toEqual({ rounds: 1, forgiven: true });
  });
  it("rounds before your first call don't count against you", () => {
    expect(callingStreak(season, new Set(["3a", "4a"]), NOW)).toEqual({ rounds: 2, forgiven: false });
  });
  it("a round still being played is no miss until it ends", () => {
    const live = [...season, m("6a", 6, 0.1, false), m("6b", 6, -1)];
    expect(callingStreak(live, new Set(["3a", "4a"]), NOW)).toEqual({ rounds: 2, forgiven: false });
    expect(callingStreak(live, new Set(["3a", "4a", "6a"]), NOW).rounds).toBe(3);
  });
  it("nothing called, no streak", () => {
    expect(callingStreak(season, new Set(), NOW)).toEqual({ rounds: 0, forgiven: false });
  });
});
