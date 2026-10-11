const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** The league's mark: the gold-edged shield with the ball and the open book. */
export function BallMark({ size = 44 }: { size?: number }) {
  // Width and height are set so the header never shifts while the picture loads.
  return <img className="ballmark" src={`${base}/brand/shield-small.png`} width={Math.round(size * 0.888)} height={size} alt="" />;
}

export function Brand() {
  return (
    <div className="brand">
      <BallMark />
      <div>
        <div className="wordmark">Scrum<span>line</span></div>
        <div className="subword">Get our schools over the line</div>
      </div>
    </div>
  );
}
