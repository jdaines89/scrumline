"use client";

import Link from "next/link";
import { useLeague } from "@/components/league";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

/** "February 2027", from a season's first day. */
export function startsIn(startsOn: string | null): string | null {
  const m = startsOn?.match(/^(\d{4})-(\d{2})/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null;
}

/**
 * A tournament loaded before its fixtures are out (the Varsity Cup in
 * October): when it starts, and that leagues can get going now.
 */
export function SeasonAhead() {
  const { season, matches } = useLeague();
  if (season.is_replay || matches.length > 0) return null;
  const when = startsIn(season.starts_on);
  return (
    <div className="card season-ahead">
      <h2>{when ? `Starts ${when}` : "Starting soon"}</h2>
      <p>The {season.name} fixtures appear here as soon as they&apos;re published, and you call every score from there.</p>
      <p className="small muted">Your leagues are ready now, so it&apos;s a good time to invite people. <Link href="/leagues/">Your leagues</Link></p>
    </div>
  );
}
