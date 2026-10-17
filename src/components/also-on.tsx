"use client";

import { useEffect, useState } from "react";
import { useLeague } from "@/components/league";
import { kickoff, roundName } from "@/lib/format";
import { seasonLine, type NextUp } from "@/lib/seasons";
import { TournamentLogo } from "@/components/tournament-logo";
import { supabase } from "@/lib/supabase";

/**
 * Every other tournament still to come or being played, in one quiet card
 * (nothing to dismiss, no banners), each a tap away. One with a round in the
 * next eight days goes first and says when it starts.
 */
export function AlsoOn() {
  const { seasons, season, setSeason, competitions } = useLeague();
  // Each other tournament's next match.
  const [nexts, setNexts] = useState<NextUp[]>([]);
  const others = seasons.filter((s) => !s.is_replay && s.id !== season.id).map((s) => s.id).join(",");
  useEffect(() => {
    setNexts([]);
    if (!others) return;
    supabase.from("matches").select("season, round, kickoff_at").in("season", others.split(","))
      .gt("kickoff_at", new Date().toISOString()).order("kickoff_at").limit(100)
      .then(({ data }) => {
        const rows = (data ?? []) as NextUp[];
        setNexts(rows.filter((r, i) => rows.findIndex((x) => x.season === r.season) === i));
      });
  }, [others]);

  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const soon = (id: string) => {
    const n = nexts.find((x) => x.season === id);
    return n && Date.parse(n.kickoff_at) - now <= 8 * 864e5 ? n : null;
  };
  const more = seasons.filter((s) => !s.is_replay && s.id !== season.id && (!s.ends_on || s.ends_on >= today))
    .map((s) => ({ s, next: soon(s.id) }))
    .sort((a, b) => {
      const key = (x: typeof a) => x.next ? "0" + x.next.kickoff_at : "1" + (x.s.starts_on ?? "");
      return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
    });
  if (!more.length) return null;
  return (
    <div className="card also-more">
      <h3>Also on Scrumline</h3>
      {more.map(({ s, next }) => (
        <button type="button" className="also-more-row" key={s.id} onClick={() => setSeason(s.id)}>
          <TournamentLogo competition={competitions.get(s.competition_id)} size={32} />
          <span className="also-more-text">
            <strong>{s.name}</strong>
            <span>{!next ? seasonLine(s)
              : s.starts_on && s.starts_on < today ? `Next game ${kickoff(next.kickoff_at)}`
              : `${roundName(next.round)} starts ${kickoff(next.kickoff_at)}`}</span>
          </span>
          <span className="also-more-go" aria-hidden="true">Switch</span>
        </button>
      ))}
    </div>
  );
}
