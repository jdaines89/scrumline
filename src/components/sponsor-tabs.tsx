"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: [string, string][] = [
  ["/sponsor/", "Schools"],
  ["/sponsor/tournament/", "Tournaments"],
  ["/sponsor/prizes/", "Prizes"],
  ["/sponsor/results/", "Results"],
  ["/giving/", "Giving"],
  ["/sponsor/profile/", "Profile"],
];

/** The business pages, for a player who also sponsors (business accounts have these in the header). */
export function SponsorTabs() {
  const path = usePathname() ?? "";
  const on = (href: string) => href === "/sponsor/"
    ? path.startsWith("/sponsor") && !/^\/sponsor\/(profile|results|tournament|prizes)/.test(path)
    : path.startsWith(href);
  return (
    <nav className="subtabs" aria-label="Business">
      {TABS.map(([href, label]) => <Link key={href} href={href} className={on(href) ? "on" : ""}>{label}</Link>)}
    </nav>
  );
}
