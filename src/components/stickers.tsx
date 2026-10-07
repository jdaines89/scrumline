import type { ReactNode } from "react";

// Rugby stickers for the league chat. A sticker message stores its key in
// chat_messages.sticker and its label as the body, so quotes, previews and
// older versions of the app still read sensibly ("Yellow card").
// Each one is drawn here, so stickers cost nothing to store or load.

interface Sticker { key: string; label: string; tone: [string, string]; art: ReactNode }

const W = "#fff";
const ball = (cx: number, cy: number, r = 1, rot = -30) => (
  <g transform={`translate(${cx} ${cy}) rotate(${rot}) scale(${r})`}>
    <ellipse rx="17" ry="11" fill="#c8733a" stroke="#5a2c10" strokeWidth="2" />
    <path d="M-9 0h18M-5-3v6M0-3v6M5-3v6" stroke={W} strokeWidth="1.8" strokeLinecap="round" />
  </g>
);

export const STICKERS: Sticker[] = [
  { key: "yellow_card", label: "Yellow card", tone: ["#3d3510", "#1d1a08"], art: (
    <g transform="rotate(-10 60 46)">
      <rect x="42" y="18" width="36" height="50" rx="4" fill="#f5c518" stroke="#7a5d00" strokeWidth="2" />
      <path d="M48 26h14" stroke="#fff6" strokeWidth="3" strokeLinecap="round" />
    </g>
  ) },
  { key: "red_card", label: "Red card", tone: ["#43150f", "#200806"], art: (
    <g transform="rotate(8 60 46)">
      <rect x="42" y="18" width="36" height="50" rx="4" fill="#e23b2e" stroke="#7a1209" strokeWidth="2" />
      <path d="M48 26h14" stroke="#fff6" strokeWidth="3" strokeLinecap="round" />
    </g>
  ) },
  { key: "tmo", label: "TMO check", tone: ["#14283d", "#0a1420"], art: (
    <g>
      <rect x="30" y="20" width="60" height="42" rx="5" fill="#0f1b28" stroke="#7fb3e6" strokeWidth="2.5" strokeDasharray="7 5" />
      <text x="60" y="48" textAnchor="middle" fontSize="17" fontWeight="800" fill="#cfe6ff" letterSpacing="2">TMO</text>
    </g>
  ) },
  { key: "ref", label: "Ref!", tone: ["#1f2a33", "#0e1419"], art: (
    <g>
      <path d="M34 46a16 16 0 1 0 32 0V38H34z" fill="#d7dde2" stroke="#59646d" strokeWidth="2" />
      <rect x="62" y="34" width="26" height="12" rx="3" fill="#d7dde2" stroke="#59646d" strokeWidth="2" />
      <circle cx="50" cy="48" r="5" fill="#59646d" />
      <path d="M90 26l6-6M92 36h8M88 18l2-8" stroke="#f5c518" strokeWidth="3" strokeLinecap="round" />
    </g>
  ) },
  { key: "try", label: "Try!", tone: ["#14402a", "#0a2016"], art: (
    <g>
      <path d="M14 58h92" stroke={W} strokeWidth="3" />
      <path d="M14 66h92" stroke="#ffffff55" strokeWidth="2" strokeDasharray="4 6" />
      {ball(60, 50, 1.15, -12)}
      <path d="M30 26l4 8M60 14v10M90 26l-4 8" stroke="#f5c518" strokeWidth="3" strokeLinecap="round" />
    </g>
  ) },
  { key: "drop_goal", label: "Drop goal", tone: ["#14402a", "#0a2016"], art: (
    <g>
      <path d="M40 70V12M80 70V12M40 46h40" stroke={W} strokeWidth="4" strokeLinecap="round" />
      {ball(60, 28, 0.75, 20)}
      <path d="M60 64v-14" stroke="#ffffff66" strokeWidth="2" strokeDasharray="3 4" />
    </g>
  ) },
  { key: "scrum_down", label: "Scrum down", tone: ["#2c2416", "#16120a"], art: (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 30l18 16-18 16" fill="none" stroke="#35c98a" strokeWidth="7" />
      <path d="M36 30l18 16-18 16" fill="none" stroke="#35c98a" strokeWidth="7" opacity=".6" />
      <path d="M98 30L80 46l18 16" fill="none" stroke="#e0b23c" strokeWidth="7" />
      <path d="M84 30L66 46l18 16" fill="none" stroke="#e0b23c" strokeWidth="7" opacity=".6" />
    </g>
  ) },
  { key: "knock_on", label: "Knock-on", tone: ["#33230f", "#191107"], art: (
    <g>
      {ball(44, 30, 0.95, -40)}
      <path d="M58 26q16-10 26 10" fill="none" stroke={W} strokeWidth="3" strokeLinecap="round" strokeDasharray="4 5" />
      {ball(86, 56, 0.8, 30)}
      <path d="M22 64h30" stroke="#ffffff55" strokeWidth="2" />
    </g>
  ) },
  { key: "forward_pass", label: "Forward pass", tone: ["#33230f", "#191107"], art: (
    <g>
      {ball(36, 46, 0.9, 0)}
      <path d="M54 46h34" stroke={W} strokeWidth="4" strokeLinecap="round" />
      <path d="M80 36l12 10-12 10" fill="none" stroke={W} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  ) },
  { key: "banker", label: "Banker!", tone: ["#3d3010", "#1d1708"], art: (
    <g>
      <circle cx="60" cy="42" r="26" fill="#e0b23c" stroke="#7a5d00" strokeWidth="2.5" />
      <circle cx="60" cy="42" r="19" fill="none" stroke="#fff3" strokeWidth="2" />
      <text x="60" y="50" textAnchor="middle" fontSize="22" fontWeight="800" fill="#3d2c00">×2</text>
    </g>
  ) },
  { key: "lekker", label: "Lekker!", tone: ["#14402a", "#0a2016"], art: (
    <g>
      <path d="M44 66V42h8l10-22c6 0 9 4 8 10l-3 10h17c5 0 8 4 7 8l-4 14c-1 4-4 6-8 6H52" fill="#f2c79a" stroke="#7a4a22" strokeWidth="2.5" strokeLinejoin="round" />
      <rect x="32" y="40" width="12" height="30" rx="3" fill="#35c98a" stroke="#1d6f4d" strokeWidth="2" />
    </g>
  ) },
  { key: "eish", label: "Eish", tone: ["#2a1f33", "#140f19"], art: (
    <g>
      <circle cx="60" cy="44" r="26" fill="#f5c518" stroke="#7a5d00" strokeWidth="2.5" />
      <path d="M48 40q4-4 8 0M64 40q4-4 8 0" fill="none" stroke="#3d2c00" strokeWidth="3" strokeLinecap="round" />
      <path d="M50 56q10-6 20 0" fill="none" stroke="#3d2c00" strokeWidth="3" strokeLinecap="round" />
      <path d="M82 30q4 8 0 12q-4-4 0-12z" fill="#7fc6ff" />
    </g>
  ) },
];

const BY_KEY = new Map(STICKERS.map((s) => [s.key, s]));

export function stickerLabel(key: string | null | undefined) {
  return (key && BY_KEY.get(key)?.label) || "Sticker";
}

/** One sticker, drawn at `size` pixels square. */
export function StickerArt({ k, size = 120 }: { k: string; size?: number }) {
  const s = BY_KEY.get(k);
  const id = `st-${k}`;
  return (
    <svg className="sticker" width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={s?.label ?? "Sticker"}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={s?.tone[0] ?? "#182621"} />
          <stop offset="1" stopColor={s?.tone[1] ?? "#0d1412"} />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="116" height="116" rx="22" fill={`url(#${id})`} stroke="#ffffff22" strokeWidth="2" />
      {s?.art}
      <text x="60" y="102" textAnchor="middle" fontSize={(s?.label.length ?? 7) > 10 ? 13 : 15} fontWeight="800" fill="#fff" letterSpacing=".5">
        {s?.label ?? "Sticker"}
      </text>
    </svg>
  );
}

/** The sticker sheet: tap one to send it. */
export function StickerPicker({ onPick, onClose }: { onPick: (key: string) => void; onClose: () => void }) {
  return (
    <div className="wip-dim" onClick={onClose}>
      <div className="wip-sheet stickersheet" role="dialog" aria-modal="true" aria-labelledby="sticker-title" onClick={(e) => e.stopPropagation()}>
        <div className="tsheet-head">
          <h2 id="sticker-title">Stickers</h2>
          <button type="button" className="ghost tsheet-done" onClick={onClose}>Cancel</button>
        </div>
        <div className="stickergrid">
          {STICKERS.map((s) => (
            <button key={s.key} type="button" className="stickerbtn" aria-label={`Send ${s.label}`} onClick={() => onPick(s.key)}>
              <StickerArt k={s.key} size={88} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
