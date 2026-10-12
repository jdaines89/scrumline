"use client";

import { useEffect, useMemo, useState } from "react";
import { FixtureCard, fixtureDay } from "@/components/fixture-card";
import { useLeague } from "@/components/league";
import { readCache, writeCache } from "@/lib/cache";
import { roundName } from "@/lib/format";
import { seasonStatus } from "@/lib/seasons";
import { supabase } from "@/lib/supabase";
import type { Match } from "@/lib/types";

const PAGE = 30;

/** What's coming up in every tournament that is on or about to start, as one calendar by date. */
export function CombinedCalendar() {
  const { seasons, competitions, teams } = useLeague();
  const live = useMemo(() => seasons.filter((s) => !s.is_replay && (seasonStatus(s) === "On now" || seasonStatus(s) === "Coming up")), [seasons]);
  const ids = live.map((s) => s.id);
  const key = `calendar:${ids.join(",")}`;
  const [matches, setMatches] = useState<Match[] | null>(() => readCache<Match[]>(key) ?? null);
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    if (!ids.length) { setMatches([]); return; }
    // From a few hours back, so a match in progress still shows.
    const since = new Date(Date.now() - 3 * 3600_000).toISOString();
    supabase.from("matches").select("*").in("season", ids).gte("kickoff_at", since).order("kickoff_at").limit(300)
      .then(({ data, error }) => { if (error) return; const m = (data ?? []) as Match[]; writeCache(key, m); setMatches(m); });
  }, [key]);

  if (matches === null) return <div className="card"><div className="match skeleton" style={{ height: 150 }} /></div>;
  if (!matches.length) return <p className="muted">Nothing coming up yet. Fixtures appear here as tournaments release them.</p>;

  const seasonOf = new Map(seasons.map((s) => [s.id, s]));
  const list = matches.slice(0, shown);
  const days = new Map<string, Match[]>();
  for (const m of list) { const d = fixtureDay(m.kickoff_at); days.set(d, [...(days.get(d) ?? []), m]); }

  return (
    <>
      {[...days].map(([d, ms], i) => (
        <div className="card" key={d}>
          <h2>{d}</h2>
          {i === 0 && <p className="sub">Every tournament, by date. Kick-off times are South African time.</p>}
          {ms.map((m) => <FixtureCard key={m.id} m={m} teams={teams} competition={competitions.get(seasonOf.get(m.season)?.competition_id ?? "")} round={roundName(m.round)} />)}
        </div>
      ))}
      {shown < matches.length && <button type="button" className="ghost" style={{ width: "100%" }} onClick={() => setShown(shown + PAGE)}>Show more</button>}
    </>
  );
}
