import { describe, expect, it } from "vitest";
import { monthName, names, offerMonths } from "../src/lib/recruiter-months";

describe("recruiter prize months", () => {
  it("names the month from its first day", () => {
    expect(monthName("2026-10-01")).toBe("October");
  });
  it("offers this month and next in South African time", () => {
    expect(offerMonths(new Date("2026-10-15T10:00:00Z"))).toEqual(["2026-10-01", "2026-11-01"]);
    // 23:00 UTC on 31 October is already 1 November in SAST
    expect(offerMonths(new Date("2026-10-31T23:00:00Z"))).toEqual(["2026-11-01", "2026-12-01"]);
    expect(offerMonths(new Date("2026-12-10T10:00:00Z"))).toEqual(["2026-12-01", "2027-01-01"]);
  });
  it("lists names briefly", () => {
    const n = (id: string) => id.toUpperCase();
    expect(names(["a", "b"], n)).toBe("A and B");
    expect(names(["a", "b", "c", "d"], n)).toBe("A, B and 2 more");
  });
});
