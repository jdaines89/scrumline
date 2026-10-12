"use client";

import { useEffect, useState } from "react";
import { useLeague } from "@/components/league";
import { readCache, writeCache } from "@/lib/cache";
import { ord } from "@/lib/growth";
import { supabase } from "@/lib/supabase";
import { GroundRules } from "@/components/ground-rules";

interface EveryoneRow { pos: number | null; place: number | null; team_name: string; points: number; mine: boolean; players: number; resting_players: number }

/**
 * Where you stand among everyone playing this tournament, across every league:
 * the top three and the two either side of you, by team name only.
 */
export function EveryoneTable() {
  const { season } = useLeague();
  const key = `sl:everyone:${season.id}`;
  const [rows, setRows] = useState<EveryoneRow[] | null>(() => readCache<EveryoneRow[]>(key) ?? null);

  useEffect(() => {
    setRows(readCache<EveryoneRow[]>(key) ?? null);
    supabase.rpc("everyone_table", { p_season: season.id })
      .then(({ data, error }) => { if (error) return; const r = (data ?? []) as EveryoneRow[]; writeCache(key, r); setRows(r); });
  }, [key, season.id]);

  if (rows === null) {
    return (
      <ol className="board" aria-busy="true" aria-label="Loading the table">
        {[0, 1, 2].map((i) => <li key={i} className="skeleton" style={{ height: 52 }} />)}
      </ol>
    );
  }
  const me = rows.find((r) => r.mine);
  const players = rows[0]?.players ?? 0;
  const resting = rows[0]?.resting_players ?? 0;
  const ranked = rows.filter((r) => r.place !== null).sort((a, b) => a.pos! - b.pos!);
  const tied = me?.place != null && ranked.filter((r) => r.place === me.place).length > 1;

  return (
    <>
      <p className="everyone-head">
        {me?.place != null
          ? <>You&apos;re <strong>{tied ? "joint " : ""}{ord(me.place)}</strong> of {players.toLocaleString("en-ZA")} {players === 1 ? "player" : "players"} in the <span className="nowrap">{season.name}</span>.</>
          : me ? <>You&apos;re taking a break. Your next call puts you back among the {players.toLocaleString("en-ZA")} players.</>
          : <>{players.toLocaleString("en-ZA")} {players === 1 ? "player" : "players"} in the <span className="nowrap">{season.name}</span>.</>}
      </p>
      {ranked.length > 0 && (
        <ol className="board everyone">
          {ranked.map((r, i) => (
            <li key={r.team_name} className={`${r.mine ? "me" : ""}${i > 0 && r.pos! - ranked[i - 1].pos! > 1 ? " gap" : ""}`}>
              <div className="brow">
                <span className="rank">{r.place}</span>
                <div className="who"><strong>{r.team_name}</strong></div>
                <span className="btotal">{r.points}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
      {me && me.place === null && (
        <ol className="board resting"><li className="me"><div className="brow"><span className="rank">–</span><div className="who"><strong>{me.team_name}</strong></div><span className="btotal">{me.points}</span></div></li></ol>
      )}
      <GroundRules title="Every caller, every league" lines={[
        ["One table for the whole tournament.", "Everyone who calls, whatever league they play in."],
        ["Team names only.", "No one sees who you are, just how you call."],
        ...(resting > 0 ? [["Taking a break?", `${resting.toLocaleString("en-ZA")} ${resting === 1 ? "player is" : "players are"} back on the table with their next call.`] as [string, string]] : []),
      ]} />
    </>
  );
}
