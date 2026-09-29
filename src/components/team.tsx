"use client";

import { useState } from "react";
import type { Team as TeamRow } from "@/lib/types";

/**
 * The unions' badges are their trademarks, so the app shows each team as its
 * jersey colour with initials. Official badges only come back with
 * NEXT_PUBLIC_SHOW_OFFICIAL_LOGOS=1 at build time, once there is a licence.
 */
const OFFICIAL_LOGOS = process.env.NEXT_PUBLIC_SHOW_OFFICIAL_LOGOS === "1";

export function Crest({ team, size = 26 }: { team: TeamRow; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (OFFICIAL_LOGOS && team.badge_url && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="crest" src={team.badge_url} alt="" style={style} loading="lazy" onError={() => setFailed(true)} />;
  }
  return (
    <span className="crest disc" aria-hidden
      style={{ ...style, background: team.colour ?? "#3b4a44", color: team.colour_ink ?? "#fff", fontSize: size * 0.36 }}>
      {team.short_name}
    </span>
  );
}

export function Team({ team, align = "left", bold = true }: {
  team: TeamRow | undefined; align?: "left" | "right"; bold?: boolean;
}) {
  if (!team) return null;
  const name = bold ? <strong>{team.display_name}</strong> : <span>{team.display_name}</span>;
  return (
    <span className={`team ${align}`}>
      {align === "right" ? <>{name}<Crest team={team} /></> : <><Crest team={team} />{name}</>}
    </span>
  );
}

export function stripe(team: TeamRow | undefined) {
  return { boxShadow: `inset 4px 0 0 ${team?.colour ?? "transparent"}` };
}
