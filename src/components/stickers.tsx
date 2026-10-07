import type { ReactNode } from "react";

// Rugby stickers for the league chat. A sticker message stores its key in
// chat_messages.sticker and its label as the body, so quotes, previews and
// older versions of the app still read sensibly ("Yellow card").
// Each one is drawn here, so stickers cost nothing to store or load.
// Moving parts carry an `a-*` class (see globals.css): in the chat a sticker
// pops in and plays a few times, then rests; in the picker it keeps playing.

interface Sticker { key: string; label: string; tone: [string, string]; art: ReactNode }

const W = "#fff";
const INK = "#1b1530";

const ball = (cx: number, cy: number, s = 1, rot = -30) => (
  <g transform={`translate(${cx} ${cy}) rotate(${rot}) scale(${s})`}>
    <ellipse rx="17" ry="11" fill="#e07b39" stroke={INK} strokeWidth="2.5" />
    <path d="M-12-4q12-6 24 0" fill="none" stroke="#ffffff66" strokeWidth="2" strokeLinecap="round" />
    <path d="M-8 1h16M-4-2v6M0-2v6M4-2v6" stroke={W} strokeWidth="1.8" strokeLinecap="round" />
  </g>
);
const spark = (x: number, y: number, s = 1, delay = 0, fill = "#fff27a") => (
  <g className="a-twinkle" style={{ animationDelay: `${delay}s` }}>
    <path transform={`translate(${x} ${y}) scale(${s})`} d="M0-7L1.8-1.8 7 0 1.8 1.8 0 7-1.8 1.8-7 0-1.8-1.8z" fill={fill} />
  </g>
);
// A raised arm holding a card up, ref-style.
const cardUp = (fill: string) => (
  <g className="a-flick">
    <path d="M58 84l4-22" stroke={INK} strokeWidth="12" strokeLinecap="round" />
    <path d="M58 84l4-22" stroke="#f2c79a" strokeWidth="7" strokeLinecap="round" />
    <g transform="rotate(-12 62 40)">
      <rect x="46" y="14" width="34" height="46" rx="5" fill={fill} stroke={INK} strokeWidth="3" />
      <path d="M52 21h13" stroke="#ffffff99" strokeWidth="3.5" strokeLinecap="round" />
    </g>
    <circle cx="61" cy="62" r="6.5" fill="#f2c79a" stroke={INK} strokeWidth="2.5" />
  </g>
);
const flash = <path className="a-pulse" d="M26 30l-8-4M24 44h-9M90 26l8-5M94 40h9" stroke={W} strokeWidth="3.5" strokeLinecap="round" />;

export const STICKERS: Sticker[] = [
  { key: "yellow_card", label: "Yellow card", tone: ["#8a5cff", "#5326d6"], art: <g>{cardUp("#ffd21f")}{flash}</g> },
  { key: "red_card", label: "Red card", tone: ["#3f86ff", "#1d4fd1"], art: <g>{cardUp("#ff3b30")}{flash}</g> },
  { key: "tmo", label: "TMO check", tone: ["#16345c", "#0a1730"], art: (
    <g>
      <rect x="24" y="16" width="72" height="50" rx="8" fill="#0b1f38" stroke={INK} strokeWidth="3" />
      <rect className="a-march" x="30" y="22" width="60" height="38" rx="5" fill="none" stroke="#3ff0ff" strokeWidth="3" strokeDasharray="8 6" />
      <text x="60" y="47" textAnchor="middle" fontSize="16" fontWeight="900" fill="#c9fbff" letterSpacing="3">TMO</text>
      <g className="a-blink"><circle cx="88" cy="22" r="3.5" fill="#ff3b30" /></g>
    </g>
  ) },
  { key: "ref", label: "Ref!", tone: ["#ff9a2e", "#e05a00"], art: (
    <g>
      <g className="a-wiggle">
        <path d="M30 44a17 17 0 1 0 34 0V36H30z" fill="#e9eef2" stroke={INK} strokeWidth="3" />
        <rect x="60" y="31" width="28" height="13" rx="4" fill="#e9eef2" stroke={INK} strokeWidth="3" />
        <circle cx="47" cy="47" r="5.5" fill={INK} />
        <path d="M36 40q4-4 10-4" fill="none" stroke={W} strokeWidth="3" strokeLinecap="round" />
      </g>
      <g className="a-pulse"><path d="M94 24q8 10 0 20M100 18q13 16 0 32" fill="none" stroke={W} strokeWidth="3.5" strokeLinecap="round" /></g>
    </g>
  ) },
  { key: "try", label: "Try!", tone: ["#2fd16f", "#0f8f47"], art: (
    <g>
      <path d="M10 66h100" stroke={W} strokeWidth="4" />
      <path d="M10 74h100" stroke="#ffffff77" strokeWidth="2.5" strokeDasharray="5 6" />
      <g className="a-slam">{ball(60, 54, 1.25, -10)}</g>
      {spark(26, 30, 1.2, 0)}{spark(94, 26, 1.4, .3)}{spark(60, 18, 1, .6, W)}{spark(80, 42, .8, .9)}{spark(40, 42, .8, .45, W)}
    </g>
  ) },
  { key: "drop_goal", label: "Drop goal", tone: ["#4fc8ff", "#1b82e0"], art: (
    <g>
      <path d="M38 78V10M82 78V10M38 52h44" stroke={INK} strokeWidth="8" strokeLinecap="round" />
      <path d="M38 78V10M82 78V10M38 52h44" stroke={W} strokeWidth="4.5" strokeLinecap="round" />
      <g className="a-arc">{ball(60, 30, .8, 30)}</g>
      {spark(26, 20, .9, .2)}{spark(94, 30, .9, .7)}
    </g>
  ) },
  { key: "scrum_down", label: "Scrum down", tone: ["#ffc93c", "#f08a00"], art: (
    <g strokeLinecap="round" strokeLinejoin="round" fill="none">
      <g className="a-push-r">
        <path d="M14 28l18 18-18 18" stroke={INK} strokeWidth="11" />
        <path d="M14 28l18 18-18 18" stroke="#16b85e" strokeWidth="6" />
        <path d="M30 28l18 18-18 18" stroke={INK} strokeWidth="11" />
        <path d="M30 28l18 18-18 18" stroke="#2fe07d" strokeWidth="6" />
      </g>
      <g className="a-push-l">
        <path d="M106 28L88 46l18 18" stroke={INK} strokeWidth="11" />
        <path d="M106 28L88 46l18 18" stroke="#d6331f" strokeWidth="6" />
        <path d="M90 28L72 46l18 18" stroke={INK} strokeWidth="11" />
        <path d="M90 28L72 46l18 18" stroke="#ff5a3c" strokeWidth="6" />
      </g>
    </g>
  ) },
  { key: "knock_on", label: "Knock-on", tone: ["#ff6b9a", "#d61f5b"], art: (
    <g>
      <path d="M14 74h92" stroke="#ffffff88" strokeWidth="3" strokeLinecap="round" />
      <g className="a-hop">{ball(54, 42, 1.1, -35)}</g>
      <g className="a-wiggle"><text x="94" y="36" textAnchor="middle" fontSize="22" fontWeight="900" fill={W} stroke={INK} strokeWidth="1.2">!?</text></g>
    </g>
  ) },
  { key: "forward_pass", label: "Forward pass", tone: ["#ff5a47", "#c4200f"], art: (
    <g>
      {ball(30, 44, .95, 0)}
      <g className="a-nudge" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M52 44h36M80 32l14 12-14 12" stroke={INK} strokeWidth="10" />
        <path d="M52 44h36M80 32l14 12-14 12" stroke={W} strokeWidth="5" />
      </g>
      <g className="a-blink"><path d="M78 12l12 12M90 12L78 24" stroke="#ffe14d" strokeWidth="4" strokeLinecap="round" /></g>
    </g>
  ) },
  { key: "banker", label: "Banker!", tone: ["#14c98a", "#067a50"], art: (
    <g>
      <g className="a-coin">
        <circle cx="60" cy="42" r="27" fill="#ffd23f" stroke={INK} strokeWidth="3" />
        <circle cx="60" cy="42" r="20" fill="none" stroke="#b07a00" strokeWidth="2.5" />
        <text x="60" y="51" textAnchor="middle" fontSize="24" fontWeight="900" fill="#6b4700">×2</text>
      </g>
      {spark(24, 22, 1.2, 0)}{spark(98, 30, 1.3, .4)}{spark(94, 66, .9, .8, W)}
    </g>
  ) },
  { key: "lekker", label: "Lekker!", tone: ["#1fd6c1", "#068a7c"], art: (
    <g>
      <g className="a-thumb">
        <path d="M46 76V48h9l11-25c7 0 10 5 9 11l-3 11h18c6 0 9 5 8 9l-5 16c-1 4-5 6-9 6H55" fill="#f6c58f" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
        <rect x="32" y="46" width="14" height="34" rx="4" fill="#ffd21f" stroke={INK} strokeWidth="3" />
      </g>
      {spark(24, 24, 1.1, .1)}{spark(98, 22, 1.2, .5)}
    </g>
  ) },
  { key: "eish", label: "Eish", tone: ["#b366ff", "#7426e0"], art: (
    <g>
      <g className="a-wiggle">
        <circle cx="58" cy="44" r="28" fill="#ffd21f" stroke={INK} strokeWidth="3" />
        <path d="M45 42q5-5 10 0M62 42q5-5 10 0" fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
        <path d="M47 60q11-7 22 0" fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
        <path d="M40 28q8-10 22-8" fill="none" stroke="#ffffff99" strokeWidth="3" strokeLinecap="round" />
      </g>
      <g className="a-drip"><path d="M92 22q6 10 0 15q-6-5 0-15z" fill="#7fd4ff" stroke={INK} strokeWidth="2" /></g>
    </g>
  ) },
];

const BY_KEY = new Map(STICKERS.map((s) => [s.key, s]));

export function stickerLabel(key: string | null | undefined) {
  return (key && BY_KEY.get(key)?.label) || "Sticker";
}

/** One sticker, drawn at `size` pixels square. `loop` keeps it moving (the picker). */
export function StickerArt({ k, size = 120, loop = false }: { k: string; size?: number; loop?: boolean }) {
  const s = BY_KEY.get(k);
  const id = `st-${k}`;
  const label = s?.label ?? "Sticker";
  // The label pill grows with the words, so "Forward pass" fits as well as "Ref!".
  const fs = label.length > 10 ? 12 : 13.5;
  const pill = Math.min(102, 22 + label.length * fs * 0.64);
  return (
    <svg className={`sticker${loop ? " loop" : ""}`} width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={label}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2=".4" y2="1">
          <stop offset="0" stopColor={s?.tone[0] ?? "#2fd16f"} />
          <stop offset="1" stopColor={s?.tone[1] ?? "#0f8f47"} />
        </linearGradient>
      </defs>
      <rect x="5" y="5" width="110" height="110" rx="30" fill={`url(#${id})`} stroke={W} strokeWidth="5" />
      <path d="M24 14h34" stroke="#ffffff40" strokeWidth="5" strokeLinecap="round" />
      {s?.art}
      <g transform="rotate(-4 60 98)">
        <rect x={60 - pill / 2} y="86" width={pill} height="22" rx="11" fill={INK} stroke={W} strokeWidth="2.5" />
        <text x="60" y="101.5" textAnchor="middle" fontSize={fs} fontWeight="900" fill={W} letterSpacing=".3">{label}</text>
      </g>
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
              <StickerArt k={s.key} size={88} loop />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
