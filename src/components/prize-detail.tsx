"use client";

import { useEffect } from "react";
import { SponsorAbout, SponsorTile } from "@/components/sponsor-tile";
import { prizePhotoUrl, whoWon, type PoolPrize } from "@/lib/prizes";

const STATE: Partial<Record<PoolPrize["status"], string>> = {
  upcoming: "Up for grabs", "in play": "Round in play", "no winner": "No winner this round",
  delivered: "Delivered", "not delivered": "Not delivered",
};

/**
 * A round prize in full, over the page: the photo, what it is, the details
 * the business gave, and who the business is with its website. Tap outside,
 * the close button or Escape to go back.
 */
export function PrizeDetail({ prize, nameOf, onClose }: { prize: PoolPrize; nameOf: (id: string) => string; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);

  const winners = prize.winners?.length ? whoWon(prize, nameOf) : null;
  const state = prize.status === "awaiting" ? `Won by ${winners}, on its way` : winners ? `Won by ${winners}` : STATE[prize.status];

  return (
    <div className="pz-back" onClick={onClose}>
      <div className="pz-sheet" role="dialog" aria-modal="true" aria-label={`Round ${prize.round} prize`} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="pz-close" aria-label="Close" onClick={onClose}>×</button>
        {prize.image_path && <img className="pz-photo" src={prizePhotoUrl(prize.image_path)} alt={prize.prize} />}
        <div className="pz-body">
          <span className="prize-label">Round {prize.round} prize</span>
          <h3>{prize.prize}</h3>
          {prize.details && <p className="pz-details">{prize.details}</p>}
          {state && <p className="prize-meta">{state}</p>}
          <div className="pz-biz">
            <SponsorTile name={prize.sponsor} logo={prize.sponsor_logo} />
            <div>
              <small>Offered by {nameOf(prize.offered_by)} from</small>
              <b>{prize.sponsor}</b>
            </div>
          </div>
          <SponsorAbout about={prize.sponsor_about} website={prize.sponsor_website} />
        </div>
      </div>
    </div>
  );
}
