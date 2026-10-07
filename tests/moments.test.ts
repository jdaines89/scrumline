import { describe, expect, it } from "vitest";
import { groupReveals, ordinal, placeLine, splitLines, teamRef } from "../src/lib/moments";

const c = (name: string, h: number, a: number, me = false) => ({ name, home_score: h, away_score: a, me });

describe("kickoff reveal lines", () => {
  it("counts who backs which side, biggest first", () => {
    const r = splitLines([c("Pieter", 24, 20), c("Andy", 30, 10), c("Elsa", 17, 22), c("Tyler", 27, 13)], "Stormers", "Bulls");
    expect(r.split).toBe("3 back the Stormers, 1 the Bulls.");
    expect(r.lone).toBe("Elsa is the only one backing the Bulls.");
  });

  it("speaks to you when you're the one on your own", () => {
    const r = splitLines([c("Justin", 17, 22, true), c("Andy", 30, 10), c("Elsa", 27, 13)], "Stormers", "Bulls");
    expect(r.lone).toBe("You're the only one backing the Bulls.");
  });

  it("says when everyone agrees, and counts draws", () => {
    expect(splitLines([c("A", 20, 10), c("B", 25, 3)], "Lions", "Sharks")).toEqual({ split: "Everyone backs the Lions.", lone: null });
    expect(splitLines([c("A", 20, 10), c("B", 15, 15)], "Lions", "Sharks").split).toBe("1 backs the Lions. 1 calls a draw.");
  });

  it("only puts 'the' before one-word plural team names", () => {
    expect(["Stormers", "Bulls", "Connacht", "South Africa", "Wales", "Ireland", "Maties"].map(teamRef))
      .toEqual(["the Stormers", "the Bulls", "Connacht", "South Africa", "Wales", "Ireland", "the Maties"]);
    expect(splitLines([c("A", 20, 10), c("B", 30, 3), c("C", 10, 20)], "Connacht", "Dragons").split).toBe("2 back Connacht, 1 the Dragons.");
  });

  it("names nobody alone in a two-way split", () => {
    expect(splitLines([c("A", 20, 10), c("B", 10, 20)], "Lions", "Sharks").lone).toBeNull();
  });
});

describe("full-time place line", () => {
  const l = { pool_id: 1, name: "The Originals", of: 5, rank_now: 2, rank_before: 4, passed: ["Pieter"] };
  it("says how far you climbed and who you passed", () => {
    expect(placeLine(l)).toBe("Up to 2nd in The Originals, past Pieter.");
    expect(placeLine({ ...l, passed: ["A", "B"] })).toBe("Up to 2nd in The Originals, past 2 players.");
    expect(placeLine({ ...l, rank_now: 3, rank_before: 1 })).toBe("Down to 3rd in The Originals.");
    expect(placeLine({ ...l, rank_before: 2 })).toBe("Still 2nd in The Originals.");
  });
  it("writes places the English way", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st"]);
  });
});

describe("match-day cards", () => {
  it("puts a day's games in one card, by South African date", () => {
    const g = groupReveals([
      { id: 3, match_id: "c", created_at: "2026-10-10T15:05:00Z" },
      { id: 1, match_id: "a", created_at: "2026-10-09T18:50:00Z" },
      { id: 2, match_id: "b", created_at: "2026-10-10T13:00:00Z" },
      { id: 4, match_id: "d", created_at: "2026-10-10T22:30:00Z" }, // after midnight in South Africa
    ]);
    expect(g).toEqual([
      { id: 1, created_at: "2026-10-09T18:50:00Z", match_ids: ["a"] },
      { id: 2, created_at: "2026-10-10T13:00:00Z", match_ids: ["b", "c"] },
      { id: 4, created_at: "2026-10-10T22:30:00Z", match_ids: ["d"] },
    ]);
  });
});
