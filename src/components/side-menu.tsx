"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { reportProblem } from "@/components/report-problem";
import { signOut } from "@/lib/push";

/** Small line icons for the menu and the bottom bar, one stroke style throughout. */
const ICONS: Record<string, string> = {
  home: "M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10",
  predict: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  leagues: "M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7",
  chat: "M4 5h16v11H9l-5 4z",
  matches: "M4 6h16v14H4zM4 10h16M9 3v4M15 3v4",
  trytime: "M12 3c4.5 2.5 7 6 7 9s-2.5 6.5-7 9c-4.5-2.5-7-6-7-9s2.5-6.5 7-9zM8.5 12h7M10 9.5l4 5M14 9.5l-4 5",
  achievements: "M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z",
  profile: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.6-7 8-7s8 3 8 7",
  business: "M3 8h18v12H3zM8 8V5h8v3M3 13h18",
  school: "M12 4L2 9l10 5 10-5zM6 11v5c3 2 9 2 12 0v-5",
  giving: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z",
  rules: "M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7",
  report: "M12 3l9 16H3zM12 10v4M12 17v.5",
  signout: "M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10",
};

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}

export interface MenuItem { href: string; label: string; icon: string; on: boolean; badge?: React.ReactNode }

/** The phone's left-hand menu: the ☰ button opens it, and so does a swipe right from the screen's left edge. */
export function SideMenu({ main, more, who }: { main: MenuItem[]; more: MenuItem[]; who?: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const drag = useRef<{ x: number; y: number; from: "edge" | "menu" } | null>(null);

  // Any move to another screen closes it.
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    document.documentElement.classList.toggle("menu-open", open);
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Swipe right from the left edge opens it; swipe left anywhere closes it.
  useEffect(() => {
    const phone = window.matchMedia("(max-width: 560px)");
    const start = (e: TouchEvent) => {
      const t = e.touches[0];
      if (open) { drag.current = { x: t.clientX, y: t.clientY, from: "menu" }; return; }
      // Leave photos and sheets alone: they have swipes of their own.
      if (!phone.matches || t.clientX > 24 || document.querySelector(".photoview, .pz-sheet, .wip-sheet")) return;
      drag.current = { x: t.clientX, y: t.clientY, from: "edge" };
    };
    const move = (e: TouchEvent) => {
      const d = drag.current;
      if (!d) return;
      const t = e.touches[0];
      const dx = t.clientX - d.x, dy = t.clientY - d.y;
      if (Math.abs(dy) > 30 && Math.abs(dy) > Math.abs(dx)) { drag.current = null; return; }
      if (d.from === "edge" && dx > 50) { drag.current = null; setOpen(true); }
      if (d.from === "menu" && dx < -50) { drag.current = null; setOpen(false); }
    };
    const end = () => { drag.current = null; };
    document.addEventListener("touchstart", start, { passive: true });
    document.addEventListener("touchmove", move, { passive: true });
    document.addEventListener("touchend", end);
    return () => {
      document.removeEventListener("touchstart", start);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", end);
    };
  }, [open]);

  const row = (i: MenuItem) => (
    <Link key={i.href} href={i.href} className={i.on ? "on" : ""} onClick={() => setOpen(false)}>
      <Icon name={i.icon} />
      <span>{i.label}</span>
      {i.badge}
    </Link>
  );

  return (
    <>
      <button type="button" className="menubtn" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(true)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      <div className={`sidemenu${open ? " open" : ""}`} aria-hidden={!open}>
        <div className="sm-back" onClick={() => setOpen(false)} />
        <nav className="sm-panel" aria-label="Menu" inert={!open}>
          {who}
          <div className="sm-group">{main.map(row)}</div>
          {more.length > 0 && <div className="sm-group">{more.map(row)}</div>}
          <div className="sm-group">
            <button type="button" onClick={() => { setOpen(false); reportProblem(); }}><Icon name="report" /><span>Report a problem</span></button>
            <button type="button" onClick={() => signOut()}><Icon name="signout" /><span>Sign out</span></button>
          </div>
        </nav>
      </div>
    </>
  );
}
