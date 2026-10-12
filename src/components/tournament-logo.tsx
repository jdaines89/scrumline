"use client";

import { useState } from "react";
import type { Competition } from "@/lib/types";

/**
 * A tournament's official logo, or a plain trophy when there is none (or it
 * fails to load). The box is always the same size, so nothing jumps when the
 * picture arrives. Follows the team badges' NEXT_PUBLIC_SHOW_OFFICIAL_LOGOS switch.
 */
const OFFICIAL_LOGOS = process.env.NEXT_PUBLIC_SHOW_OFFICIAL_LOGOS !== "0";

export function TournamentLogo({ competition, size = 28 }: { competition: Competition | undefined; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  const url = competition?.badge_url;
  if (OFFICIAL_LOGOS && url && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="tlogo" src={url} alt="" style={style} onError={() => setFailed(true)} />;
  }
  return (
    <span className="tlogo plain" aria-hidden style={style}>
      <svg viewBox="0 0 24 24" width={size * 0.55} height={size * 0.55}>
        <path d="M7 4h10v4a5 5 0 0 1-10 0V4zM7 6H4.5a2.5 2.5 0 0 0 2.6 3M17 6h2.5a2.5 2.5 0 0 1-2.6 3M12 13v4M8.5 20h7M10 17h4v3h-4z"
          fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
