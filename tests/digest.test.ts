import { describe, expect, it } from "vitest";
import { buildDigest, type DigestMate } from "../src/lib/digest";

const matches = [
  { id: "a", home: "Lions", away: "Sharks", finished: false },
  { id: "b", home: "Bulls", away: "Stormers", finished: false },
  { id: "c", home: "Pumas", away: "Griquas", finished: false },
  { id: "d", home: "Boland", away: "Cheetahs", finished: true },
];
const call = (entry_id: number, match_id: string, h: number, a: number, is_banker = false) =>
  ({ entry_id, match_id, home_score: h, away_score: a, is_banker });
const mate = (entry_id: number, name: string, match_id: string, h: number, a: number, is_banker = false): DigestMate =>
  ({ ...call(entry_id, match_id, h, a, is_banker), name });

const mine = [call(1, "a", 24, 17, true), call(1, "b", 20, 13), call(1, "c", 15, 30), call(1, "d", 10, 20)];
const mates = [
  mate(2, "Reeves", "a", 13, 20), mate(3, "Christo", "a", 10, 25),
  mate(2, "Reeves", "b", 27, 10, true), mate(3, "Christo", "b", 10, 12),
  mate(2, "Reeves", "c", 12, 33), mate(3, "Christo", "c", 13, 28),
  mate(2, "Reeves", "d", 30, 10),
];
const table = [
  { entry_id: 1, manager: "Justin", total_points: 40 },
  { entry_id: 2, manager: "Reeves", total_points: 45 },
  { entry_id: 3, manager: "Christo", total_points: 30 },
];

describe("buildDigest", () => {
  const d = buildDigest({ myEntry: 1, mine, mates, matches, table, poolName: "The Originals" })!;

  it("leads with your lone calls, then the splits", () => {
    expect(d.swings.map((s) => [s.match_id, s.kind])).toEqual([["a", "lone"], ["b", "split"]]);
    expect(d.swings[0].text).toBe("Just you on Lions · Reeves and Christo on Sharks");
    expect(d.swings[0].bankers).toEqual(["Your Banker"]);
    expect(d.swings[0].counts).toEqual({ home: 1, draw: 0, away: 2 });
    expect(d.swings[1].text).toBe("You and Reeves on Bulls · Christo on Stormers");
  });

  it("skips finished games, counts the agreed ones and what's at stake", () => {
    expect(d.agreed).toBe(1);
    expect(d.stake).toBe(18);
  });

  it("says where you stand once there are points", () => {
    expect(d.standing).toBe("You're 2nd of 3 in The Originals on 40 pts, 5 off the top.");
    expect(d.headline).toBe("1 bold call this round. Get it right and you pull away.");
  });

  it("round 1: no standings line, just the break-away pitch", () => {
    const zero = table.map((r) => ({ ...r, total_points: 0 }));
    const x = buildDigest({ myEntry: 1, mine, mates, matches, table: zero, poolName: "P" })!;
    expect(x.standing).toBeNull();
    expect(x.headline).toBe("Everyone starts on 0. Your 1 bold call is where you break away.");
  });

  it("reads in counts with a 10-person pool", () => {
    const names = ["Reeves", "Christo", "Elsa", "Andy", "Sam", "Tom", "Lee", "Kim", "Max"];
    const big = names.flatMap((n, i) => [
      mate(10 + i, n, "a", i < 7 ? 13 : 24, i < 7 ? 20 : 10, i === 0),
      mate(10 + i, n, "b", 20, 10),
      mate(10 + i, n, "c", i < 4 ? 20 : 10, i < 4 ? 10 : 20),
    ]);
    const x = buildDigest({ myEntry: 1, mine, mates: big, matches, table: [], poolName: null })!;
    expect(x.swings.map((s) => [s.match_id, s.kind])).toEqual([["a", "against"], ["c", "split"]]);
    expect(x.swings[0].text).toBe("You, Kim and Max on Lions · 7 on Sharks");
    expect(x.swings[0].bankers).toEqual(["Your Banker", "Reeves' Banker"]);
    expect(x.swings[1].text).toBe("You and 5 others on Griquas · 4 on Pumas");
    expect(x.agreed).toBe(1);
  });

  it("returns nothing before any mate's call shows", () => {
    expect(buildDigest({ myEntry: 1, mine, mates: [], matches, table, poolName: "P" })).toBeNull();
  });
});
