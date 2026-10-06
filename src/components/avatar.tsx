"use client";

import { useEffect, useState } from "react";
import { forgetLink, keptLink, signedLink } from "@/lib/signed-link";
import type { Member } from "@/lib/types";

export function initials(name?: string): string {
  return (name ?? "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

/** A member's picture, or their initials until they add one. */
export function Avatar({ member, size = 32 }: { member?: Member; size?: number }) {
  const path = member?.avatar_path ?? null;
  // Start from the link this phone already has, so the picture is there on the first frame.
  const [src, setSrc] = useState<string | null>(() => path ? keptLink("avatars", path) : null);
  useEffect(() => {
    let live = true;
    if (!path) { setSrc(null); return; }
    const kept = keptLink("avatars", path);
    if (kept) { setSrc(kept); return; }
    signedLink("avatars", path).then((u) => { if (live) setSrc(u); });
    return () => { live = false; };
  }, [path]);

  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  return src
    ? <img className="avatar" src={src} alt="" style={style} onError={() => { if (path) forgetLink("avatars", path); setSrc(null); }} />
    : <span className="avatar" aria-hidden style={style}>{initials(member?.display_name)}</span>;
}
