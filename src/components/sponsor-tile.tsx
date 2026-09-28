"use client";

import { initials, logoUrl, siteName } from "@/lib/sponsor";

/** The business's logo, or its initials until it adds one. */
export function SponsorTile({ name, logo, big }: { name: string; logo: string | null; big?: boolean }) {
  return logo
    ? <img className={`sp-tile logo${big ? " big" : ""}`} src={logoUrl(logo)} alt="" />
    : <div className={`sp-tile${big ? " big" : ""}`}>{initials(name || "?")}</div>;
}

/** What a player sees on tapping a sponsor: who they are and where to find them. */
export function SponsorAbout({ about, website, onTap }: { about: string | null; website: string | null; onTap?: () => void }) {
  if (!about && !website) return null;
  return (
    <div className="sp-about">
      {about && <p>{about}</p>}
      {website && <a href={website} target="_blank" rel="noopener sponsored" onClick={onTap}>{siteName(website)} ›</a>}
    </div>
  );
}
