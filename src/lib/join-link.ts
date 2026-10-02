/**
 * A join link carries your invite code and, for a league invite, the league's
 * code in the same value: /join/?c=<invite>-<LEAGUE>. One plain parameter
 * keeps the link the same shape as the personal invite, which link previews
 * (WhatsApp's Scrumline card) already handle. ?p= still works for links
 * already sent.
 */
export function joinLink(site: string, invite: string | null, league?: string): string {
  if (!invite) return `${site}/join/?p=${league ?? ""}`;
  return `${site}/join/?c=${invite}${league ? `-${league}` : ""}`;
}

export function readJoinLink(search: string): { invite: string; league: string } {
  const q = new URLSearchParams(search);
  const [invite = "", fromC = ""] = (q.get("c") ?? "").split("-");
  return { invite, league: q.get("p") ?? fromC };
}
