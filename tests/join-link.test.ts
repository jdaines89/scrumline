import { describe, expect, it } from "vitest";
import { joinLink, readJoinLink } from "../src/lib/join-link";

describe("join links", () => {
  it("puts the league code in the invite value", () => {
    expect(joinLink("https://x", "abc123def0", "BRA1B0")).toBe("https://x/join/?c=abc123def0-BRA1B0");
    expect(readJoinLink("?c=abc123def0-BRA1B0")).toEqual({ invite: "abc123def0", league: "BRA1B0" });
  });
  it("reads plain invites and links already sent with ?p=", () => {
    expect(readJoinLink("?c=abc123def0")).toEqual({ invite: "abc123def0", league: "" });
    expect(readJoinLink("?c=abc123def0&p=BRA1B0")).toEqual({ invite: "abc123def0", league: "BRA1B0" });
    expect(readJoinLink("?p=BRA1B0")).toEqual({ invite: "", league: "BRA1B0" });
  });
});
