"use client";

import { usePathname, useRouter } from "next/navigation";
import { Tabs } from "@/components/tabs";

/** Fixtures and the log live together under the Matches tab. */
export function MatchesSwitch() {
  const path = usePathname() ?? "";
  const router = useRouter();
  const log = path.startsWith("/standings");
  return (
    <Tabs label="Matches" items={[["/fixtures/", "Fixtures"], ["/standings/", "Log"]] as const}
      value={log ? "/standings/" : "/fixtures/"} onPick={(v) => router.push(v)} />
  );
}
