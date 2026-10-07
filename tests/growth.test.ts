import { describe, expect, it } from "vitest";
import { afterRoundLine, mateAsk, nameList, ord, stillToCall, type OrganiserRow } from "../src/lib/growth";

describe("growth helpers", () => {
  it("writes places as people say them", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ord)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
  });
  it("says how the round went in your league", () => {
    const a = { round: 2, pts: 14, pool_id: 1, pool_name: "The Originals", join_code: "D0641E", members: 4, rank: 2, of: 4 };
    expect(afterRoundLine(a, "Round 2")).toBe("Round 2: you scored 14, 2nd of 4 in The Originals.");
    expect(afterRoundLine({ ...a, pool_name: null, of: 0 }, "Round 2")).toBe("Round 2: you scored 14.");
    expect(afterRoundLine({ ...a, of: 1 }, "Final")).toBe("Final: you scored 14.");
  });
  it("asks for more mates in small leagues", () => {
    expect(mateAsk(2)).toMatch(/few more/);
    expect(mateAsk(5)).toMatch(/One more player/);
    expect(mateAsk(12)).toMatch(/next rival/);
  });
  it("lists names", () => {
    expect(nameList(["A"])).toBe("A");
    expect(nameList(["A", "B"])).toBe("A and B");
    expect(nameList(["A", "B", "C"])).toBe("A, B and C");
    expect(nameList(["A", "B", "C", "D", "E"])).toBe("A, B and 3 more");
  });
  it("leaves out the organiser and anyone done", () => {
    const row = (user_id: string, called: number): OrganiserRow => ({ round: 3, first_ko: "", games: 8, user_id, display_name: user_id, called });
    expect(stillToCall([row("me", 0), row("a", 8), row("b", 3), row("c", 0)], "me").map((r) => r.user_id)).toEqual(["b", "c"]);
  });
});
