import { useId, type ReactNode } from "react";

// One medallion per achievement, in the same chalk-on-pitch style as the chat stickers.
// Colourless until it is earned; the first time an earned one is seen it pops and a
// glint runs across it (the page decides when, with `play`).

const GOLD = "#e0b23c";
const GREY = "#8b9490";

const ART: Record<string, (ink: string) => ReactNode> = {
  // Ball over the posts.
  sharpshooter: (ink) => (
    <g fill="none" stroke={ink} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M40 78V50M80 78V50M40 62h40M60 62v18" />
      <g transform="translate(60 36) rotate(-25)"><ellipse rx="11" ry="7" /><path d="M-5 0h10" strokeWidth="2" /></g>
    </g>
  ),
  // A column of ticks.
  "clean-sweep": (ink) => (
    <g fill="none" stroke={ink} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M38 40l7 7 13-14M38 62l7 7 13-14M38 84l7 7 13-14" transform="translate(4 -8)" />
      <path d="M72 42h14M72 64h14M72 86h14" strokeWidth="3" transform="translate(4 -8)" />
    </g>
  ),
  // Double.
  "banker-bang": (ink) => (
    <g>
      <g stroke={ink} strokeWidth="3" strokeLinecap="round">
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <path key={a} d="M60 24v9" transform={`rotate(${a} 60 60)`} />)}
      </g>
      <text x="60" y="71" textAnchor="middle" fontSize="30" fontWeight="900" fill={ink}>×2</text>
    </g>
  ),
  // Bullseye.
  "dead-on": (ink) => (
    <g fill="none" stroke={ink} strokeWidth="3.4">
      <circle cx="60" cy="60" r="26" /><circle cx="60" cy="60" r="15" />
      <circle cx="60" cy="60" r="5" fill={ink} stroke="none" />
    </g>
  ),
};

export function AchBadge({ k, have, goal, earned, play, size = 104 }: {
  k: string; have: number; goal: number; earned: boolean; play?: boolean; size?: number;
}) {
  const uid = useId().replace(/:/g, "");
  const ink = earned ? GOLD : GREY;
  const C = 2 * Math.PI * 54;
  return (
    <svg className={`achbadge${earned ? " on" : ""}${play ? " play" : ""}`} width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <radialGradient id={`d${uid}`} cx="50%" cy="38%" r="70%">
          <stop offset="0" stopColor={earned ? "#2a3a2c" : "#262c2a"} /><stop offset="1" stopColor="#0d1311" />
        </radialGradient>
        <clipPath id={`c${uid}`}><circle cx="60" cy="60" r="56" /></clipPath>
      </defs>
      <circle cx="60" cy="60" r="56" fill={`url(#d${uid})`} />
      <circle cx="60" cy="60" r="54" fill="none" stroke={earned ? GOLD : "#3a4440"} strokeWidth={earned ? 3 : 2} />
      {!earned && have > 0 && (
        <circle cx="60" cy="60" r="54" fill="none" stroke={GREY} strokeWidth="4" strokeLinecap="round"
          strokeDasharray={`${(have / goal) * C} ${C}`} transform="rotate(-90 60 60)" />
      )}
      <g className="ab-art">{ART[k]?.(ink)}</g>
      {earned && <g clipPath={`url(#c${uid})`}><rect className="ab-glint" x="-60" y="0" width="30" height="120" fill="#fff" opacity=".35" transform="skewX(-20)" /></g>}
    </svg>
  );
}
