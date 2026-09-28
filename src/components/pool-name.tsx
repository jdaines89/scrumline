import type { Pool } from "@/lib/types";

/** A pool's name, with a tick when it's an official school pool (made by Scrumline, never by a player). */
export function PoolName({ pool }: { pool: Pool }) {
  if (!pool.school_emis) return <>{pool.name}</>;
  const cut = pool.name.lastIndexOf(" ") + 1;
  return (
    <>
      {pool.name.slice(0, cut)}
      <span className="nowrap">{pool.name.slice(cut)}
      {(
        <svg className="verified" viewBox="0 0 16 16" width="15" height="15" role="img" aria-label="Official school pool">
          <title>Official school pool, set up by Scrumline</title>
          <path fill="currentColor" d="M8 0l1.9 1.4 2.3-.2.8 2.2 2 1.2-.5 2.3.9 2.1-1.6 1.7-.2 2.3-2.3.6-1.4 1.9-2.2-.7-2.2.7-1.4-1.9-2.3-.6-.2-2.3L0 9.1l.9-2.1-.5-2.3 2-1.2.8-2.2 2.3.2z" />
          <path fill="none" stroke="var(--bg)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" d="M5 8.2l2 2 4-4.2" />
        </svg>
      )}</span>
    </>
  );
}

/** The same for a plain-text spot like a dropdown. */
export const poolLabel = (pool: Pool) => (pool.school_emis ? `${pool.name} ✓` : pool.name);
