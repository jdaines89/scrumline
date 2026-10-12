import type { ReactNode } from "react";

/** The few lines under a ranking that say how to climb it: a stamped heading, then short
 *  lines that each lead with the point in bold. Replaces the old paragraph of small print. */
export function GroundRules({ title, lines }: { title: string; lines: [string, ReactNode][] }) {
  return (
    <section className="ground-rules" aria-label={title}>
      <h3 className="gr-stamp">{title}</h3>
      <ul>
        {lines.map(([lead, rest], i) => <li key={i}><b>{lead}</b> {rest}</li>)}
      </ul>
    </section>
  );
}
