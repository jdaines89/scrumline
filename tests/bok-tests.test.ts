import { describe, expect, it } from "vitest";
import { bokInvite, opponents, testsAhead, type BokTest } from "../src/lib/bok-tests";

const t = (id: string, kickoff_at: string): BokTest => ({ id, season: "nations-2026", kickoff_at, home_team_id: "x", away_team_id: "137137", venue: null });

describe("Bok tests card", () => {
  it("keeps only tests still to come, in kickoff order", () => {
    const all = [t("fra", "2026-11-13T20:10:00Z"), t("ita", "2026-11-07T11:40:00Z"), t("ire", "2026-11-21T16:40:00Z")];
    expect(testsAhead(all, Date.parse("2026-10-07T00:00:00Z")).map((x) => x.id)).toEqual(["ita", "fra", "ire"]);
    expect(testsAhead(all, Date.parse("2026-11-10T00:00:00Z")).map((x) => x.id)).toEqual(["fra", "ire"]);
    expect(testsAhead(all, Date.parse("2026-11-22T00:00:00Z"))).toEqual([]);
  });

  it("names the opponents in plain English", () => {
    expect(opponents(["Italy", "France", "Ireland"])).toBe("Italy, France and Ireland");
    expect(opponents(["France", "Ireland"])).toBe("France and Ireland");
    expect(opponents(["Ireland"])).toBe("Ireland");
  });

  it("carries the league and the one join link", () => {
    const text = bokInvite("Italy and France", "Nations Championship 2026", "The Originals", "https://x/join/?c=abc-DEF");
    expect(text).toContain('"The Originals"');
    expect(text).toContain("no betting");
    expect(text.endsWith("Tap to join: https://x/join/?c=abc-DEF")).toBe(true);
    expect(bokInvite("Italy", "Nations Championship 2026", null, "https://x")).toContain("calling the scores on Scrumline.");
  });
});
