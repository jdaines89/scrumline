import { describe, expect, it } from "vitest";
import { defaultSeason, pickerGroups, worthSwitching } from "../src/lib/seasons";
import type { Season } from "../src/lib/types";

// Newest first, as the app loads them.
const seasons: Season[] = [
  { id: "nations-2026", name: "Nations Championship 2026", is_replay: false, competition_id: "5852", starts_on: "2026-11-06", ends_on: "2026-11-29" },
  { id: "urc-2026-27", name: "URC 2026-27", is_replay: false, competition_id: "4446", starts_on: "2026-09-25", ends_on: null },
  { id: "2026", name: "Currie Cup 2026", is_replay: true, competition_id: "5069", starts_on: "2026-07-17" },
];
const at = (iso: string) => new Date(iso);

describe("defaultSeason", () => {
  it("opens on the URC in October, before the tests are near", () => {
    expect(defaultSeason(seasons, at("2026-10-10T12:00:00Z")).id).toBe("urc-2026-27");
  });
  it("opens on the tests in the week before they start and while they run", () => {
    expect(defaultSeason(seasons, at("2026-10-31T12:00:00Z")).id).toBe("nations-2026");
    expect(defaultSeason(seasons, at("2026-11-14T12:00:00Z")).id).toBe("nations-2026");
  });
  it("goes back to the URC once the tests are over", () => {
    expect(defaultSeason(seasons, at("2026-12-01T12:00:00Z")).id).toBe("urc-2026-27");
  });
  it("falls back to the replay when nothing is live", () => {
    expect(defaultSeason([seasons[2]], at("2026-10-10T12:00:00Z")).id).toBe("2026");
  });
});

describe("worthSwitching", () => {
  const now = Date.parse("2026-11-02T12:00:00Z");
  const tests = { season: "nations-2026", round: 4, kickoff_at: "2026-11-06T20:10:00Z" };
  it("points at the tests during the URC break", () => {
    expect(worthSwitching("2026-12-04T17:00:00Z", tests, now)).toBe(true);
    expect(worthSwitching(null, tests, now)).toBe(true);
  });
  it("stays quiet when this tournament plays first", () => {
    expect(worthSwitching("2026-11-03T17:00:00Z", tests, now)).toBe(false);
  });
  it("stays quiet when the other one is more than eight days off", () => {
    expect(worthSwitching(null, tests, Date.parse("2026-10-20T12:00:00Z"))).toBe(false);
    expect(worthSwitching(null, null, now)).toBe(false);
  });
});

describe("pickerGroups", () => {
  const vc: Season = { id: "varsity-cup-2027", name: "Varsity Cup 2027", is_replay: false, competition_id: "varsity-cup", starts_on: "2027-02-01", ends_on: null };
  const old: Season = { id: "nations-2025", name: "Nations Championship 2025", is_replay: false, competition_id: "5852", starts_on: "2025-11-01", ends_on: "2025-11-29" };
  const all = [vc, ...seasons, old];
  const names = (g: { label: string; seasons: Season[] }[]) => g.map((x) => `${x.label}: ${x.seasons.map((s) => s.id).join(", ")}`);
  it("groups what's on, coming up soonest first, and practice", () => {
    expect(names(pickerGroups(all, "urc-2026-27", at("2026-10-10T12:00:00Z")))).toEqual([
      "On now: urc-2026-27", "Coming up: nations-2026, varsity-cup-2027", "Finished: nations-2025", "Practice: 2026"]);
  });
  it("keeps tournaments that finished in the last year, newest first", () => {
    expect(names(pickerGroups(all, "urc-2026-27", at("2026-11-20T12:00:00Z")))).toEqual([
      "On now: nations-2026, urc-2026-27", "Coming up: varsity-cup-2027", "Finished: nations-2025", "Practice: 2026"]);
    expect(names(pickerGroups(all, "urc-2026-27", at("2026-12-10T12:00:00Z")))).toEqual([
      "On now: urc-2026-27", "Coming up: varsity-cup-2027", "Finished: nations-2026", "Practice: 2026"]);
  });
  it("drops one that finished over a year ago, unless you're on it", () => {
    expect(pickerGroups(all, "urc-2026-27", at("2026-12-10T12:00:00Z")).flatMap((g) => g.seasons).map((s) => s.id)).not.toContain("nations-2025");
    expect(pickerGroups(all, "nations-2025", at("2026-12-10T12:00:00Z")).flatMap((g) => g.seasons).map((s) => s.id)).toContain("nations-2025");
  });
});
