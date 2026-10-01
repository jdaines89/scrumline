"use client";

import { usePathname, useRouter } from "next/navigation";

/** Fixtures and the log live together under the Matches tab. */
export function MatchesSwitch() {
  const path = usePathname() ?? "";
  const router = useRouter();
  const log = path.startsWith("/standings");
  return (
    <div className="seg matches-seg" role="tablist" aria-label="Matches">
      <button type="button" role="tab" aria-selected={!log} className={log ? "" : "on"} onClick={() => router.push("/fixtures/")}>Fixtures</button>
      <button type="button" role="tab" aria-selected={log} className={log ? "on" : ""} onClick={() => router.push("/standings/")}>Log</button>
    </div>
  );
}
