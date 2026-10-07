import { useId, type ReactNode } from "react";

// Rugby stickers for the league chat. A sticker message stores its key in
// chat_messages.sticker and its label as the body, so quotes, previews and
// older versions of the app still read sensibly ("Yellow card").
// Each one is drawn here, so stickers cost nothing to store or load.
// The look is match-day grit, not cartoons: a dark pitch, mud and chalk,
// one simple chalk mark and a big stamped word. In the chat a sticker lands
// once with a thud and then stays still.

interface Sticker { key: string; label: string; word: string; sub?: string; ink: string; art?: ReactNode }

const CHALK = "#f1efe6";
const GOLD = "#e0b23c";
const line = { fill: "none", stroke: CHALK, strokeWidth: 3.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const ballOutline = (cx: number, cy: number, rot = -25, s = 1) => (
  <g transform={`translate(${cx} ${cy}) rotate(${rot}) scale(${s})`} {...line}>
    <ellipse rx="15" ry="9.5" />
    <path d="M-7 0h14M-3.5-2.5v5M0-2.5v5M3.5-2.5v5" strokeWidth="2.2" />
  </g>
);
const card = (fill: string) => (
  <g transform="rotate(-8 60 34)">
    <rect x="47" y="12" width="26" height="36" rx="2.5" fill={fill} />
  </g>
);

export const STICKERS: Sticker[] = [
  { key: "yellow_card", label: "Yellow card", word: "YELLOW", sub: "CARD", ink: "#f5c518", art: card("#f5c518") },
  { key: "red_card", label: "Red card", word: "RED", sub: "CARD", ink: "#e0342a", art: card("#d42a20") },
  { key: "tmo", label: "TMO check", word: "TMO", sub: "CHECK", ink: CHALK, art: (
    <path {...line} d="M38 16h44v30H38z" strokeDasharray="7 5" />
  ) },
  { key: "scrum_down", label: "Scrum down", word: "SCRUM", sub: "DOWN", ink: CHALK, art: (
    <g {...line} strokeWidth="3.6"><path d="M34 18l12 13-12 13M44 18l12 13-12 13M86 18L74 31l12 13M76 18L64 31l12 13" /></g>
  ) },
  { key: "knock_on", label: "Knock-on", word: "KNOCK", sub: "ON", ink: CHALK, art: (
    <g>{ballOutline(52, 30, -40)}<path {...line} d="M70 22l12-6M72 32h13" strokeWidth="2.6" /></g>
  ) },
  { key: "forward_pass", label: "Forward pass", word: "FORWARD", sub: "PASS", ink: CHALK, art: (
    <g>{ballOutline(40, 31, 0, .9)}<path {...line} d="M60 31h24M76 23l8 8-8 8" /></g>
  ) },
  { key: "try", label: "Try!", word: "TRY!", ink: GOLD, art: (
    <g><path {...line} d="M22 44h76" />{ballOutline(60, 33, -8)}</g>
  ) },
  { key: "drop_goal", label: "Drop goal", word: "DROP", sub: "GOAL", ink: CHALK, art: (
    <g><path {...line} d="M44 48V10M76 48V10M44 36h32" />{ballOutline(60, 22, 35, .6)}</g>
  ) },
  { key: "banker", label: "Banker!", word: "BANKER", sub: "DOUBLE", ink: GOLD, art: (
    <g><circle cx="60" cy="30" r="15" fill="none" stroke={GOLD} strokeWidth="3.2" /><text x="60" y="36" textAnchor="middle" fontSize="15" fontWeight="900" fill={GOLD}>×2</text></g>
  ) },
  { key: "vasbyt", label: "Vasbyt", word: "VASBYT", sub: "HOU VAS", ink: CHALK },
  { key: "lekker", label: "Lekker!", word: "LEKKER!", ink: GOLD, art: (
    <g {...line}><path d="M44 46V31h6l7-14q6 0 5 7l-2 7h12q5 0 4 5l-3 9q-1 3-5 3H50" /></g>
  ) },
  { key: "eish", label: "Eish", word: "EISH", ink: CHALK },
];

const BY_KEY = new Map(STICKERS.map((s) => [s.key, s]));

export function stickerLabel(key: string | null | undefined) {
  return (key && BY_KEY.get(key)?.label) || "Sticker";
}

// Mud thrown up from the bottom corner, the same on every sticker so they read as a set.
const MUD = "M4 120V86c6 4 9-2 15 1s6 9 13 9 9-6 15-3 4 10 11 12 10-3 14 1 1 10 8 12 12-4 16-1 7 3 11 3V120z";

/** One sticker, drawn at `size` pixels square. */
export function StickerArt({ k, size = 120 }: { k: string; size?: number }) {
  const s = BY_KEY.get(k);
  const uid = useId().replace(/:/g, "");
  const word = s?.word ?? "RUGBY";
  // Long words get a narrower squeeze so they fit edge to edge.
  const big = !s?.art;
  const fs = big ? (word.length >= 6 ? 26 : 38) : word.length >= 7 ? 20 : word.length >= 5 ? 25 : 30;
  const y = big ? (s?.sub ? 64 : 72) : s?.sub ? 80 : 88;
  return (
    <svg className="sticker" width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={s?.label ?? "Sticker"}>
      <defs>
        <linearGradient id={`p${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1d3324" />
          <stop offset="1" stopColor="#0c1610" />
        </linearGradient>
        <filter id={`g${uid}`} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="4" result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .55 0" result="speck" />
          <feComposite in="speck" in2="SourceGraphic" operator="in" result="grit" />
          <feBlend in="SourceGraphic" in2="grit" mode="multiply" />
        </filter>
        <filter id={`r${uid}`} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency=".08" numOctaves="2" seed="9" result="w" />
          <feDisplacementMap in="SourceGraphic" in2="w" scale="2.6" />
        </filter>
        <clipPath id={`c${uid}`}><rect x="3" y="3" width="114" height="114" rx="14" /></clipPath>
      </defs>
      <g clipPath={`url(#c${uid})`} filter={`url(#g${uid})`}>
        <rect width="120" height="120" fill={`url(#p${uid})`} />
        <path d="M0 18h120M0 58h120" stroke="#ffffff0d" strokeWidth="18" />
        <path d={MUD} fill="#3a2a1c" />
        <circle cx="96" cy="22" r="2.4" fill="#3a2a1c" /><circle cx="103" cy="31" r="1.4" fill="#3a2a1c" /><circle cx="14" cy="70" r="1.8" fill="#3a2a1c" />
      </g>
      <g filter={`url(#r${uid})`}>
        {s?.art}
        <text x="60" y={y} textAnchor="middle" fontSize={fs} fontWeight="900" fill={s?.ink ?? CHALK} letterSpacing="-.5"
          style={{ fontStretch: "75%" }}>{word}</text>
        {s?.sub && <text x="60" y={y + 21} textAnchor="middle" fontSize="13" fontWeight="800" fill={CHALK} opacity=".8" letterSpacing="3">{s.sub}</text>}
      </g>
      <rect x="3" y="3" width="114" height="114" rx="14" fill="none" stroke="#ffffff1f" strokeWidth="1.5" />
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
