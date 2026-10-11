import { describe, expect, it } from "vitest";
import { achievements, type ScoredCall } from "../src/lib/achievements";
import type { Match } from "../src/lib/types";

const m = (id: string, round: number): Match => ({
  id, season: "s", round, kickoff_at: "2026-10-01T12:00:00Z", home_team_id: "a", away_team_id: "b",
  home_score: 20, away_score: 10, venue: null, status: "FT",
});
const matches = [m("1a", 1), m("1b", 1), m("2a", 2), m("2b", 2), m("3a", 3), m("3b", 3), m("4a", 4), m("4b", 4)];
const call = (round: number, o: Partial<ScoredCall> = {}): ScoredCall =>
  ({ round, right_result: true, near_pts: 0, exact_pts: 0, is_banker: false, ...o });
const by = (calls: ScoredCall[], key: string) => achievements(calls, matches).find((a) => a.key === key)!;

describe("achievements", () => {
  it("Sharpshooter needs 3 exact scores inside 3 rounds in a row", () => {
    const inWindow = [call(1, { exact_pts: 5 }), call(2, { exact_pts: 5 }), call(3, { exact_pts: 5 })];
    expect(by(inWindow, "sharpshooter")).toMatchObject({ have: 3, earned: true });
    const spread = [call(1, { exact_pts: 5 }), call(2, { exact_pts: 5 }), call(4, { exact_pts: 5 })];
    expect(by(spread, "sharpshooter")).toMatchObject({ have: 2, earned: false });
  });
  it("Clean sweep needs every game of a round called and right", () => {
    expect(by([call(1), call(1)], "clean-sweep").earned).toBe(true);
    expect(by([call(1), call(1, { right_result: false })], "clean-sweep")).toMatchObject({ earned: false, note: "Best round: 1 of 2 winners" });
    expect(by([call(1)], "clean-sweep").earned).toBe(false);
  });
  it("Banker bang needs the Banker to be exact", () => {
    expect(by([call(1, { is_banker: true, exact_pts: 5 })], "banker-bang").earned).toBe(true);
    expect(by([call(1, { is_banker: true })], "banker-bang").earned).toBe(false);
  });
  it("Dead-on counts games with both teams within 3, in one round", () => {
    const five = Array.from({ length: 5 }, () => call(2, { near_pts: 4 }));
    expect(by(five, "dead-on")).toMatchObject({ have: 5, earned: true });
    const split = [call(1, { near_pts: 4 }), call(1, { near_pts: 4 }), call(2, { near_pts: 4 })];
    expect(by(split, "dead-on")).toMatchObject({ have: 2, earned: false });
  });
});
