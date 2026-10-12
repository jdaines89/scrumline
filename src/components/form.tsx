/** A side's last five results, oldest first, so the newest sits on the right. */
export function Form({ f, align = "left" }: { f: string | undefined; align?: "left" | "right" | "center" }) {
  if (!f) return null;
  const word = { W: "won", D: "drew", L: "lost" } as Record<string, string>;
  return (
    <span className={`form ${align}`} aria-label={`Last ${f.length}, oldest first: ${[...f].map((r) => word[r]).join(", ")}`}>
      {[...f].map((r, i) => <span key={i} className={`fr ${r}`}>{r}</span>)}
    </span>
  );
}
