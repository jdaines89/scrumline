"use client";

import { reportProblem } from "@/components/report-problem";

/** Something broke on this page: let the player try again or tell us, instead of leaving. */
export default function PageError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="card narrow">
      <h2>Something went wrong</h2>
      <p className="sub">Sorry about that. Try again, and if it keeps happening, tell us so we can fix it.</p>
      <div className="row">
        <button type="button" onClick={reset}>Try again</button>
        <button type="button" className="ghost" onClick={() => reportProblem(error.message)}>Report a problem</button>
      </div>
    </div>
  );
}
