import { describe, expect, it } from "vitest";
import { CALL_WINDOW_DAYS, callsOpen, callsOpenAt, isRugbyScore, scoreInput } from "../src/lib/rugby";

describe("rugby scores", () => {
  it("allows every total a side can reach", () => {
    for (const n of [0, 3, 5, 6, 7, 8, 9, 10, 11, 22, 99]) expect(isRugbyScore(n)).toBe(true);
  });
  it("refuses 1, 2, 4 and three digits", () => {
    for (const n of [1, 2, 4, 100, 226, -3]) expect(isRugbyScore(n)).toBe(false);
  });
  it("keeps at most two digits", () => {
    expect(scoreInput("226")).toBe("22");
    expect(scoreInput("07")).toBe("7");
    expect(scoreInput("1a5")).toBe("15");
  });
});

describe("call window", () => {
  it("opens calls 14 days before kickoff", () => {
    expect(CALL_WINDOW_DAYS).toBe(14);
    expect(callsOpenAt("2026-11-21T17:00:00Z").toISOString()).toBe("2026-11-07T17:00:00.000Z");
    const now = new Date("2026-11-07T12:00:00Z").getTime();
    expect(callsOpen("2026-11-21T11:00:00Z", now)).toBe(true);
    expect(callsOpen("2026-11-21T17:00:00Z", now)).toBe(false);
  });
});
