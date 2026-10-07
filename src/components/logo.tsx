/** The league's mark: a rugby ball on a shield, and the wordmark beside it. */
export function BallMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path d="M24 2 L43 8 V24 C43 35 34.5 42.5 24 46 C13.5 42.5 5 35 5 24 V8 Z" fill="#0f3d2a" stroke="#e0b23c" strokeWidth="2" />
      <g transform="rotate(-40 24 24)">
        <ellipse cx="24" cy="24" rx="15" ry="9" fill="#f4efe2" />
        <path d="M11 24 C17 18.5 31 18.5 37 24" fill="none" stroke="#0f3d2a" strokeWidth="1.4" />
        <path d="M11 24 C17 29.5 31 29.5 37 24" fill="none" stroke="#0f3d2a" strokeWidth="1.4" />
        <path d="M19 24 H29" stroke="#0f3d2a" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M21 22.2 V25.8 M24 22 V26 M27 22.2 V25.8" stroke="#0f3d2a" strokeWidth="1.3" strokeLinecap="round" />
      </g>
    </svg>
  );
}

export function Brand() {
  return (
    <div className="brand">
      <BallMark />
      <div>
        <div className="wordmark">Scrumline</div>
        <div className="subword">Get your school over the line</div>
      </div>
    </div>
  );
}
