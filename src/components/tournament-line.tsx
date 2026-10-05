"use client";

import { useEffect, useState } from "react";
import { SponsorAbout, SponsorTile } from "@/components/sponsor-tile";
import { tournamentEvent, type SeasonSponsor } from "@/lib/tournament-sponsor";
import { roundName } from "@/lib/format";

/**
 * The tournament's sponsors in one quiet line each: "URC 2026-27 presented by"
 * and, when the round has its own, "Round 2 sponsored by". Nothing when
 * neither is live.
 */
export function TournamentLine({ sponsors, seasonName, round, title = true, single = false }: {
  sponsors: SeasonSponsor[]; seasonName: string; round: number | null; title?: boolean;
  /** Just one line: the round's sponsor if it has one, else the tournament's. */
  single?: boolean;
}) {
  let main = title ? sponsors.find((s) => s.round === null) : undefined;
  const ofRound = round !== null ? sponsors.find((s) => s.round === round) : undefined;
  if (single && ofRound) main = undefined;
  if (!main && !ofRound) return null;
  return (
    <>
      {main && <One s={main} lead={`${seasonName} presented by`} />}
      {ofRound && <One s={ofRound} lead={`${roundName(ofRound.round)} sponsored by`} />}
    </>
  );
}

function One({ s, lead }: { s: SeasonSponsor; lead: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { tournamentEvent(s.id, "seen"); }, [s.id]);
  const more = Boolean(s.about || s.website);
  return (
    <div className="spline">
      <SponsorTile name={s.display_name} logo={s.logo_path} />
      <div>
        <div>{lead}{" "}
          {more
            ? <button type="button" className="linkish sp-name" aria-expanded={open} onClick={() => setOpen(!open)}><b>{s.display_name}</b></button>
            : <b>{s.display_name}</b>}
        </div>
        {s.offer && (s.link
          ? <a href={s.link} target="_blank" rel="noopener sponsored" onClick={() => tournamentEvent(s.id, "tap")}>{s.offer} ›</a>
          : <div>{s.offer}</div>)}
        {open && <SponsorAbout about={s.about} website={s.website} onTap={() => tournamentEvent(s.id, "tap")} />}
      </div>
    </div>
  );
}
