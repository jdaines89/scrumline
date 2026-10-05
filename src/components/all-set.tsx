"use client";

import Link from "next/link";
import { kickoff, roundText } from "@/lib/format";

export interface NextStep { title: string; detail: string; href?: string; onClick?: () => void }

/** Once every call in a round is in: when the action starts, and the few things worth doing meanwhile. */
export function AllSet({ round, firstKick, steps }: { round: number; firstKick: string; steps: NextStep[] }) {
  const started = new Date(firstKick).getTime() <= Date.now();
  return (
    <div className="allset">
      <h3>You&apos;re set for {roundText(round)}</h3>
      <p className="small muted">
        {started ? "Points land here as each game finishes." : <>First kickoff {kickoff(firstKick)}. Points land here as each game finishes.</>}
      </p>
      {steps.length > 0 && (
        <div className="nextsteps">
          {steps.map((s) => {
            const body = <><span><strong>{s.title}</strong><small className="muted block">{s.detail}</small></span><span className="chev" aria-hidden>›</span></>;
            return s.href
              ? <Link key={s.title} className="nextstep" href={s.href}>{body}</Link>
              : <button key={s.title} type="button" className="nextstep" onClick={s.onClick}>{body}</button>;
          })}
        </div>
      )}
    </div>
  );
}
