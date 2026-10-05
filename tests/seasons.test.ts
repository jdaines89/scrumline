import { describe, expect, it } from "vitest";
import { defaultSeason, worthSwitching } from "../src/lib/seasons";
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
