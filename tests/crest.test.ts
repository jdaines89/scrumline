import { describe, expect, it } from "vitest";
import { schoolHref, schoolKind, shieldFor } from "../src/lib/crest";

describe("school shields", () => {
  it("gives a school the same shield every time", () => {
    expect(shieldFor("105310050")).toEqual(shieldFor("105310050"));
  });
  it("spreads schools across colours and divisions", () => {
    const shields = Array.from({ length: 200 }, (_, i) => shieldFor(String(100000000 + i * 7919)));
    expect(new Set(shields.map((s) => s.field)).size).toBeGreaterThan(6);
    expect(new Set(shields.map((s) => s.division)).size).toBe(6);
  });
});

describe("school words", () => {
  it("names the kind of school", () => {
    expect(schoolKind({ offers_primary: true, offers_matric: false })).toBe("Primary school");
    expect(schoolKind({ offers_primary: false, offers_matric: true })).toBe("High school");
    expect(schoolKind({ offers_primary: true, offers_matric: true })).toBe("Combined school");
  });
  it("links to the school's page", () => {
    expect(schoolHref("105310050")).toBe("/school-page/?e=105310050");
  });
});
