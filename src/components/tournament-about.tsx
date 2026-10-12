"use client";

import { useEffect } from "react";
import type { Competition, Season } from "@/lib/types";
import { TOURNAMENT_INFO } from "@/lib/tournament-info";
import { seasonLine } from "@/lib/seasons";
import { TournamentLogo } from "@/components/tournament-logo";

/** Tapping a tournament's logo: the logo big, and a short history and summary. */
export function TournamentAbout({ season, competition, onClose }: { season: Season; competition: Competition | undefined; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  const info = TOURNAMENT_INFO[season.competition_id];
  const when = seasonLine(season);
  return (
    <div className="wip-dim" onClick={onClose}>
      <div className="wip-sheet tsheet tabout" role="dialog" aria-modal="true" aria-labelledby="tabout-title" onClick={(e) => e.stopPropagation()}>
        <div className="tsheet-grip" aria-hidden="true" />
        <div className="tsheet-head">
          <span />
          <button type="button" className="ghost tsheet-done" onClick={onClose}>Done</button>
        </div>
        <div className="tabout-hero">
          <TournamentLogo competition={competition} size={160} />
          <h2 id="tabout-title">{competition?.name ?? season.name}</h2>
          <p className="muted">{season.name}{when ? ` · ${when}` : ""}</p>
        </div>
        {info ? (
          <>
            <p className="tabout-summary">{info.summary}</p>
            <dl className="tabout-facts">
              <div><dt>How it works</dt><dd>{info.format}</dd></div>
              <div><dt>When</dt><dd>{info.when}</dd></div>
              <div><dt>South Africa</dt><dd>{info.sa}</dd></div>
              <div><dt>History</dt><dd>{info.history}</dd></div>
            </dl>
          </>
        ) : <p className="muted">More about this tournament soon.</p>}
      </div>
    </div>
  );
}
