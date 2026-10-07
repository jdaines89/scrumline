import { describe, expect, it } from "vitest";
import { bestMoment, type Moments } from "../src/lib/share-moments";

const none: Moments = { round: 3, exact: [], lone: [], round_top: null, class_lead: null };
const exact = { match_id: "1", home: "Sharks", away: "Bulls", home_score: 24, away_score: 20, callers: 412, same: 3 };
const lone = { match_id: "2", home: "Glasgow", away: "Stormers", home_score: 18, away_score: 15, winner: "Glasgow", league: "The Originals", callers: 9 };

describe("bestMoment", () => {
  it("is nothing when there's nothing to share", () => {
    expect(bestMoment(null)).toBeNull();
    expect(bestMoment(none)).toBeNull();
  });

  it("puts an exact call first, with counts and no other names", () => {
    const m = bestMoment({ ...none, exact: [exact], lone: [lone], class_lead: { school: "Victoria Park High School", school_year: 2007, ranked: 4 } })!;
    expect(m.kind).toBe("exact");
    expect(m.headline).toBe("Sharks 24–20 Bulls");
    expect(m.detail).toBe("I called it exactly. Only 3 of 412 did.");
    expect(m.said).toBe("Only 3 of 412 called Sharks v Bulls exactly.");
  });

  it("says when you were the only one", () => {
    expect(bestMoment({ ...none, exact: [{ ...exact, same: 1 }] })!.detail).toBe("I called it exactly, the only one of 412 who did.");
  });

  it("then a lone call, a round win and your class", () => {
    expect(bestMoment({ ...none, lone: [lone] })!.detail).toBe("I was the only one of 9 in The Originals to back Glasgow.");
    const top = bestMoment({ ...none, round_top: { league: "The Originals", callers: 9, pts: 24, joint: true } })!;
    expect(top.kicker).toBe("Joint top of Round 3");
    const cls = bestMoment({ ...none, class_lead: { school: "Victoria Park High School", school_year: 2007, ranked: 4 } })!;
    expect(cls.headline).toBe("Class of 2007");
    expect(cls.detail).toBe("Leading Victoria Park High School, 1st of 4 class years.");
  });
});
