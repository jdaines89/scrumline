"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** A picture full size over the page. Tap anywhere, or press Escape, to close. */
export function ImageView({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return createPortal(
    <div className="photoview" role="dialog" aria-label={alt} onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} />
    </div>,
    document.body,
  );
}

/** Wraps a small picture so a tap opens it full size. Without a picture it's just the children. */
export function TapToEnlarge({ src, alt, children }: { src: string | null; alt: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!src) return <>{children}</>;
  return (
    <>
      <button type="button" className="img-tap" aria-label={`See ${alt} full size`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}>
        {children}
      </button>
      {open && <ImageView src={src} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}
