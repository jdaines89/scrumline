import { describe, expect, it } from "vitest";
import { initials, money, split } from "../src/lib/sponsor";

describe("sponsor money", () => {
  it("splits 20/20/20/40 with the remainder to Scrumline, like the database", () => {
    expect(split(350000)).toEqual({ own: 70000, twin: 70000, prizes: 70000, scrumline: 140000 });
    const odd = split(100001);
    expect(odd.own + odd.twin + odd.prizes + odd.scrumline).toBe(100001);
    expect(odd.scrumline).toBe(40001);
  });
  it("formats rand and rupees from cents", () => {
    expect(money(350000)).toBe("R3,500");
    expect(money(150050)).toBe("R1,500.50");
    expect(money(500000, "INR")).toBe("₹5,000");
  });
  it("makes a short tile from a business name", () => {
    expect(initials("Van Zyl Motors")).toBe("VZM");
    expect(initials("Spar")).toBe("SPA");
  });
});
