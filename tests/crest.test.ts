import { describe, expect, it } from "vitest";
import { provinceName, schoolHref, schoolKind } from "../src/lib/crest";

describe("school words", () => {
  it("names the kind of school", () => {
    expect(schoolKind({ offers_primary: true, offers_matric: false })).toBe("Primary school");
    expect(schoolKind({ offers_primary: false, offers_matric: true })).toBe("High school");
    expect(schoolKind({ offers_primary: true, offers_matric: true })).toBe("Combined school");
  });
  it("spells out the province", () => {
    expect(provinceName("KZN")).toBe("KwaZulu-Natal");
    expect(provinceName("EC")).toBe("Eastern Cape");
  });
  it("links to the school's page", () => {
    expect(schoolHref("105310050")).toBe("/school-page/?e=105310050");
  });
});
