import { describe, expect, it } from "vitest";
import { roundName, roundShort, roundText } from "../src/lib/format";

describe("round names", () => {
  it("names league rounds by number", () => {
    expect(roundName(5)).toBe("Round 5");
    expect(roundText(5)).toBe("round 5");
    expect(roundShort(5)).toBe("R5");
  });
  it("names the feed's knockout rounds", () => {
    expect(roundName(125)).toBe("Quarter-finals");
    expect(roundName(150)).toBe("Semi-finals");
    expect(roundText(200)).toBe("the final");
    expect(roundShort(200)).toBe("F");
  });
});
