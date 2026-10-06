import { describe, expect, it } from "vitest";
import { callsToSave } from "../src/lib/pending-calls";

const now = new Date("2026-10-22T12:00:00Z").getTime();
const p = {
  season: "urc-2026-27",
  calls: { a: [24, 17], b: [31, 13], c: [2, 10], d: [18, 20] } as Record<string, [number, number]>,
  kickoffs: { a: "2026-10-23T17:00:00Z", b: "2026-10-21T17:00:00Z", c: "2026-10-23T17:00:00Z", d: "2026-10-24T13:00:00Z" },
};

describe("callsToSave", () => {
  it("keeps real rugby scores for games that haven't kicked off", () => {
    expect(callsToSave(p, "urc-2026-27", now)).toEqual([
      { match_id: "a", home_score: 24, away_score: 17 },
      { match_id: "d", home_score: 18, away_score: 20 },
    ]);
  });
  it("saves nothing for another tournament, or when there's nothing waiting", () => {
    expect(callsToSave(p, "nations-2026", now)).toEqual([]);
    expect(callsToSave(null, "urc-2026-27", now)).toEqual([]);
  });
});
