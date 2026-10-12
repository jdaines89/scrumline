import { useId } from "react";

/**
 * A small landscape for each province, drawn here (no photos, no coats of
 * arms): the places and plants people know it by. It sits behind the province's
 * row, fading in from the right, so nine rows read like a collage of the country.
 */
const SCENES: Record<string, { label: string; sky: [string, string]; draw: () => React.ReactNode }> = {
  WC: {
    label: "Table Mountain and a king protea",
    sky: ["#3d5b78", "#e0a35a"],
    draw: () => (
      <>
        <path d="M0 72 L18 60 L34 40 L48 44 L62 30 L170 29 L186 40 L198 36 L212 46 L226 52 L240 58 L240 100 L0 100Z" fill="#4c6276" />
        <path d="M62 30 L170 29 L168 34 L64 35Z" fill="#6f8598" />
        <path d="M0 80 Q120 74 240 82 L240 100 L0 100Z" fill="#2c4a5c" />
        <path d="M0 86 Q60 82 120 88 T240 86 L240 100 L0 100Z" fill="#14281f" />
        <g transform="translate(206 74)">
          <path d="M0 22 L0 6" stroke="#2d4a2c" strokeWidth="2.4" />
          <path d="M-14 4 Q-12 -14 0 -20 Q12 -14 14 4 Q7 -2 0 0 Q-7 -2 -14 4Z" fill="#c9768a" />
          <path d="M-9 -2 L-6 -16 L-2 -4 L0 -20 L2 -4 L6 -16 L9 -2Z" fill="#e3a0ae" />
          <ellipse cx="0" cy="0" rx="8" ry="4" fill="#f0d6c6" />
          <path d="M-14 16 Q-20 8 -12 6 M14 16 Q20 8 12 6" stroke="#2d4a2c" strokeWidth="3" fill="none" strokeLinecap="round" />
        </g>
      </>
    ),
  },
  EC: {
    label: "Hole in the Wall on the Wild Coast and an aloe",
    sky: ["#2e5f7a", "#d8b07a"],
    draw: () => (
      <>
        <path d="M0 64 L240 62 L240 100 L0 100Z" fill="#2b6a80" />
        <path d="M0 70 Q30 66 60 70 T120 70 T180 70 T240 70" stroke="#9fd0d8" strokeOpacity=".35" fill="none" />
        <path fillRule="evenodd" fill="#3b4a3c" d="M70 66 L76 40 L92 30 L118 28 L140 36 L150 52 L152 66Z M108 66 L110 54 Q116 46 122 54 L124 66Z" />
        <path d="M0 82 Q40 72 80 80 Q100 84 130 78 L160 74 Q200 72 240 80 L240 100 L0 100Z" fill="#1d3a2a" />
        <g transform="translate(176 84)" fill="#5e8a5a">
          <path d="M0 0 Q-20 -6 -26 -2 Q-14 -2 0 4Z" />
          <path d="M0 0 Q20 -6 26 -2 Q14 -2 0 4Z" />
          <path d="M0 0 Q-12 -16 -16 -22 Q-6 -12 2 0Z" />
          <path d="M0 0 Q12 -16 16 -22 Q6 -12 -2 0Z" />
          <path d="M-1 0 L-2 -38 L2 -38 L1 0Z" fill="#3f5a3a" />
          <path d="M-3 -38 L0 -54 L3 -38Z" fill="#e2702e" />
          <path d="M-2 -30 L-11 -40 L-8 -48 L-6 -36Z M2 -30 L11 -40 L8 -48 L6 -36Z" fill="#d9612a" />
        </g>
      </>
    ),
  },
  KZN: {
    label: "The Drakensberg Amphitheatre and the warm Indian Ocean",
    sky: ["#35587a", "#c7a3a0"],
    draw: () => (
      <>
        <path d="M0 58 L20 50 L30 52 L44 34 L52 38 L60 26 L70 32 L84 22 L96 30 L110 24 L124 30 L136 26 L150 36 L162 32 L176 44 L196 42 L220 54 L240 50 L240 100 L0 100Z" fill="#53607a" />
        <path d="M44 34 L52 38 L60 26 L70 32 L84 22 L96 30 L110 24 L124 30 L136 26 L150 36 L150 46 L44 46Z" fill="#6b7590" opacity=".7" />
        <path d="M0 74 Q50 56 110 70 T240 66 L240 100 L0 100Z" fill="#2f5c3c" />
        <path d="M0 88 Q60 76 130 86 T240 82 L240 100 L0 100Z" fill="#163222" />
        <path d="M150 92 Q170 88 190 92 T240 90" stroke="#9fd0d8" strokeOpacity=".3" fill="none" />
      </>
    ),
  },
  GP: {
    label: "The Johannesburg skyline, a mine headgear and a mine dump",
    sky: ["#3a4466", "#e08a4e"],
    draw: () => (
      <>
        <path d="M0 76 L30 60 L80 58 L104 76Z" fill="#b89a52" opacity=".75" />
        <g fill="#2a3346">
          <rect x="112" y="50" width="12" height="40" />
          <rect x="126" y="38" width="10" height="52" />
          <rect x="138" y="56" width="14" height="34" />
          <path d="M156 90 L156 46 L166 40 L176 46 L176 90Z" />
          <rect x="180" y="58" width="12" height="32" />
          <path d="M200 90 L201.5 22 L204.5 22 L206 90Z" />
          <ellipse cx="203" cy="22" rx="5" ry="6" />
          <path d="M202 16 L203 6 L204 16Z" />
          <rect x="210" y="62" width="16" height="28" />
        </g>
        <g stroke="#202838" strokeWidth="2.4" fill="none">
          <path d="M40 90 L56 44 L72 90 M48 70 L64 70 M44 80 L68 80" />
          <path d="M56 44 L86 90" />
          <circle cx="56" cy="44" r="7" />
        </g>
        <path d="M0 88 L240 86 L240 100 L0 100Z" fill="#15221c" />
      </>
    ),
  },
  LP: {
    label: "A baobab in the bushveld at sunset",
    sky: ["#5a3f55", "#e3874a"],
    draw: () => (
      <>
        <circle cx="96" cy="58" r="16" fill="#f2b45e" opacity=".85" />
        <path d="M0 80 Q80 72 160 78 T240 76 L240 100 L0 100Z" fill="#3a3a2e" />
        <g fill="#1e211a">
          <path d="M160 92 Q158 62 164 44 L196 44 Q202 62 200 92Z" />
          <path d="M166 46 L150 28 M168 44 L162 20 M180 44 L178 16 M190 44 L196 22 M194 46 L214 30" stroke="#1e211a" strokeWidth="4" strokeLinecap="round" />
          <path d="M150 28 L142 24 M150 28 L148 20 M162 20 L156 14 M178 16 L172 10 M178 16 L184 10 M196 22 L202 16 M214 30 L222 26 M214 30 L216 22" stroke="#1e211a" strokeWidth="2" strokeLinecap="round" />
        </g>
        <path d="M0 90 Q120 84 240 90 L240 100 L0 100Z" fill="#171a14" />
      </>
    ),
  },
  MP: {
    label: "The Three Rondavels over the Blyde River Canyon",
    sky: ["#3c5c6e", "#b9b28a"],
    draw: () => (
      <>
        <path d="M0 62 L240 58 L240 100 L0 100Z" fill="#46604a" />
        <g fill="#8a6a4a">
          <path d="M96 64 L98 42 Q106 30 114 42 L116 64Z" />
          <path d="M122 64 L124 38 Q133 24 142 38 L144 64Z" />
          <path d="M150 64 L152 44 Q160 32 168 44 L170 64Z" />
        </g>
        <g fill="#3f5a36">
          <ellipse cx="106" cy="38" rx="9" ry="4" />
          <ellipse cx="133" cy="33" rx="10" ry="4.5" />
          <ellipse cx="160" cy="40" rx="9" ry="4" />
        </g>
        <path d="M80 66 L190 64 L200 74 L70 76Z" fill="#6d5338" />
        <path d="M60 86 Q130 74 210 84" stroke="#7fb3c0" strokeOpacity=".5" strokeWidth="3" fill="none" />
        <g fill="#1a3324">
          {[8, 22, 36, 200, 214, 228].map((x) => <path key={x} d={`M${x} 92 L${x + 7} 66 L${x + 14} 92Z`} />)}
        </g>
        <path d="M0 92 L240 92 L240 100 L0 100Z" fill="#14281d" />
      </>
    ),
  },
  NW: {
    label: "An umbrella thorn tree in the bushveld hills",
    sky: ["#4a4a66", "#e2a456"],
    draw: () => (
      <>
        <circle cx="84" cy="66" r="18" fill="#f6c46a" opacity=".8" />
        <path d="M0 70 Q40 52 90 64 Q130 50 180 62 Q210 56 240 64 L240 100 L0 100Z" fill="#5c5038" />
        <path d="M0 84 Q120 76 240 84 L240 100 L0 100Z" fill="#2c2a1e" />
        <g fill="#1e2018" stroke="#1e2018" strokeLinecap="round">
          <path d="M178 92 L180 60 L170 46 M180 62 L196 44 M180 60 L182 42" strokeWidth="3" fill="none" />
          <path d="M146 44 Q180 30 222 42 Q186 50 146 44Z" />
        </g>
        <path d="M0 92 L240 92 L240 100 L0 100Z" fill="#191a14" />
      </>
    ),
  },
  FS: {
    label: "Golden Gate's sandstone cliffs and cosmos flowers",
    sky: ["#3f6488", "#d9c08a"],
    draw: () => (
      <>
        <path d="M0 70 L30 52 L60 50 L80 62 L240 64 L240 100 L0 100Z" fill="#7b6a52" />
        <path d="M110 70 L114 50 Q108 40 118 32 L170 30 Q182 38 174 50 L178 70Z" fill="#c9893e" />
        <path d="M114 46 L176 44 M116 56 L176 56" stroke="#a46a2c" strokeWidth="2" />
        <path d="M118 32 L170 30 L168 36 L120 37Z" fill="#e2a95a" />
        <path d="M0 80 Q120 70 240 78 L240 100 L0 100Z" fill="#3c5a32" />
        <g>
          {[[150, 86, "#e4a0c4"], [166, 82, "#f0f0f0"], [182, 88, "#d0709c"], [198, 82, "#e4a0c4"], [212, 88, "#f0f0f0"], [226, 84, "#d0709c"], [136, 90, "#d0709c"]].map(([x, y, c]) => (
            <g key={`${x}`}>
              <path d={`M${x} ${Number(y) + 3} L${x} 100`} stroke="#2f4a28" strokeWidth="1.2" />
              <circle cx={x} cy={y} r="3.6" fill={String(c)} />
              <circle cx={x} cy={y} r="1.2" fill="#e8b23a" />
            </g>
          ))}
        </g>
      </>
    ),
  },
  NC: {
    label: "A quiver tree under the Karoo's night sky",
    sky: ["#141f3a", "#4a4a6e"],
    draw: () => (
      <>
        <g fill="#f4ecd0">
          {[[70, 14], [92, 26], [118, 10], [136, 30], [158, 16], [176, 8], [196, 24], [222, 12], [104, 40], [232, 34], [146, 46]].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={x % 3 ? 0.9 : 1.4} opacity=".85" />
          ))}
        </g>
        <path d="M0 76 L60 64 L110 70 L170 60 L240 68 L240 100 L0 100Z" fill="#3a3346" />
        <path d="M0 86 Q120 78 240 86 L240 100 L0 100Z" fill="#2a2a24" />
        <g stroke="#1c1a18" strokeLinecap="round" fill="none">
          <path d="M184 94 L185 58" strokeWidth="6" />
          <path d="M185 60 L172 46 M185 60 L198 44 M172 46 L164 36 M172 46 L176 32 M198 44 L192 32 M198 44 L208 34" strokeWidth="3" />
        </g>
        <g fill="#2c3a24">
          {[[164, 34], [177, 30], [191, 30], [209, 32]].map(([x, y]) => <ellipse key={x} cx={x} cy={y} rx="6" ry="4" />)}
        </g>
        <g fill="#e89a34">
          {[130, 142, 150, 214, 224, 232].map((x, i) => <circle key={x} cx={x} cy={92 + (i % 2) * 3} r="2" />)}
        </g>
      </>
    ),
  },
};

export function ProvinceScene({ code }: { code: string }) {
  const id = useId().replace(/:/g, "");
  const s = SCENES[code];
  if (!s) return null;
  const sky = `sky${id}`;
  return (
    <svg className="pscene" viewBox="0 0 240 100" preserveAspectRatio="xMaxYMax slice" role="img" aria-label={s.label}>
      <title>{s.label}</title>
      <defs>
        <linearGradient id={sky} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={s.sky[0]} />
          <stop offset="1" stopColor={s.sky[1]} />
        </linearGradient>
      </defs>
      <rect width="240" height="100" fill={`url(#${sky})`} />
      {s.draw()}
    </svg>
  );
}
