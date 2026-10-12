"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { Crest, useCrests } from "@/components/crest";
import { useLeague } from "@/components/league";
import { schoolHref } from "@/lib/crest";
import { readCache, writeCache } from "@/lib/cache";
import { supabase } from "@/lib/supabase";
import { SchoolRace } from "@/components/school-race";
import { SchoolBreakdown } from "@/components/school-breakdown";
import { SCHOOL_MINIMUM, SCHOOL_TRIAL } from "@/lib/school";

type Stage = "high" | "primary";
interface SchoolRow {
  emis: string; name: string; town: string | null; members: number; confirmed: number;
  score: number | null; rounds_counted: number; best_turnout: number; mine: boolean;
}
const TEAM = 20;
const MINIMUM = SCHOOL_MINIMUM;

/**
 * Schools against each other for this tournament. Each round a school scores
 * the average of its best 20 confirmed players who played, once at least 10
 * did; the season score adds the rounds up.
 */
export function SchoolTable() {
  const { season } = useLeague();
  const crests = useCrests();
  const [stage, setStage] = useState<Stage>("high");
  const [open, setOpen] = useState<string | null>(null);
  const key = `schools3:${season.id}:${stage}`;
  const [rows, setRows] = useState<SchoolRow[] | null>(() => readCache<SchoolRow[]>(key) ?? null);

  useEffect(() => {
    setRows(readCache<SchoolRow[]>(key) ?? null);
    supabase.rpc("school_table", { p_season: season.id, p_stage: stage })
      .then(({ data }) => { const r = (data ?? []) as SchoolRow[]; writeCache(key, r); setRows(r); });
  }, [key, season.id, stage]);

  const ranked = (rows ?? []).filter((r) => r.score !== null)
    .sort((a, b) => Number(b.score) - Number(a.score) || b.rounds_counted - a.rounds_counted || a.name.localeCompare(b.name));
  const waiting = (rows ?? []).filter((r) => r.score === null)
    .sort((a, b) => b.confirmed - a.confirmed || b.members - a.members || a.name.localeCompare(b.name));

  const place = (r: SchoolRow) => 1 + ranked.filter((x) => Number(x.score) > Number(r.score)).length;
  const mineRow = [...ranked, ...waiting].find((r) => r.mine);
  const stageWord = stage === "high" ? "high" : "primary";

  return (
    <>
      <div className="seg sm wide" role="tablist" aria-label="School stage">
        {(["high", "primary"] as const).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={stage === s} className={stage === s ? "on" : ""} onClick={() => setStage(s)}>
            {s === "high" ? "High schools" : "Primary schools"}
          </button>
        ))}
      </div>
      {rows === null ? (
        <ol className="board" aria-busy="true" aria-label="Loading the table">
          {[0, 1].map((i) => <li key={i} className="skeleton" style={{ height: 66 }} />)}
        </ol>
      ) : rows.length === 0 ? (
        <p className="muted">No one has added a {stage} school yet. Add yours on your profile.</p>
      ) : (
        <>
          {mineRow && <PrideCard row={mineRow} ranked={ranked} place={place} stage={stageWord} crest={crests.get(mineRow.emis)} />}
          {ranked.length > 1 && <SchoolRace season={season.id} stage={stage} />}
          {ranked.length > 0 && (
            <ol className="board schools-table">
              {ranked.map((r) => (
                <li key={r.emis} className={`${r.mine ? "me" : ""} p${Math.min(place(r), 4)}`}>
                  <div className="srow">
                    <span className="rank">{place(r)}</span>
                    <Crest emis={r.emis} path={crests.get(r.emis)} size={36} />
                    <Link href={schoolHref(r.emis)} className="sch-link sname">{r.name}</Link>
                    <span className="btotal">{Number(r.score).toFixed(1)}</span>
                    <Meta parts={[r.town, SCHOOL_TRIAL ? `${r.confirmed} ${r.confirmed === 1 ? "player" : "players"}` : `${r.confirmed} confirmed`, `${r.rounds_counted} ${r.rounds_counted === 1 ? "round" : "rounds"}`]} />
                    <button type="button" className="sch-how-btn srow-how" aria-expanded={open === r.emis}
                      onClick={() => setOpen(open === r.emis ? null : r.emis)}>
                      Points by round
                      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" className={open === r.emis ? "up" : ""}><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                  </div>
                  {open === r.emis && <SchoolBreakdown emis={r.emis} stage={stage} season={season.id} total={Number(r.score)} />}
                </li>
              ))}
            </ol>
          )}
          {waiting.length > 0 && (
            <>
              {ranked.length > 0 && <p className="small muted school-waiting">Not ranked yet</p>}
              <ol className="board schools-table waiting">
                {waiting.map((r) => (
                  <li key={r.emis} className={r.mine ? "me" : ""}>
                    <div className="srow norank">
                      <Crest emis={r.emis} path={crests.get(r.emis)} size={36} />
                      <Link href={schoolHref(r.emis)} className="sch-link sname">{r.name}</Link>
                      <Meta parts={SCHOOL_TRIAL
                        ? [`${r.members} in the league`, "ranked after a scored call"]
                        : r.confirmed < MINIMUM
                        ? [`${r.confirmed} of ${MINIMUM} confirmed players needed`, `${r.members} in the league`]
                        : [`${r.confirmed} confirmed`, `needs ${MINIMUM} to play in the same round`]} />
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}
      <p className="small muted" style={{ marginTop: 12 }}>
        {SCHOOL_TRIAL ? <>
        Every round, a school scores the average of its best {TEAM} players who played that round. The table adds the
        rounds up, so a school that turns up every week climbs. For now every player counts straight away; the
        10-player minimum and schoolmate vouching are switched off while we try it out.
        </> : <>
        Every round, a school scores the average of its best {TEAM} confirmed players who played that round. At least{" "}
        {MINIMUM} confirmed players have to play for the round to count; otherwise the school scores 0 for it. The table adds
        the rounds up, so a school that turns up every week climbs. Players are confirmed when two schoolmates vouch for
        them on their profiles.
        </>}
      </p>
      <p className="small" style={{ marginTop: 8 }}><Link href="/giving/">See what sponsors have given each school</Link></p>
    </>
  );
}

/** Your school, up top: where it stands and who it is chasing (or holding off). The pride bit. */
function PrideCard({ row, ranked, place, stage, crest }: { row: SchoolRow; ranked: SchoolRow[]; place: (r: SchoolRow) => number; stage: string; crest?: string | null }) {
  const ranks = row.score !== null;
  const at = ranks ? place(row) : 0;
  const above = ranks && at > 1 ? ranked.filter((x) => Number(x.score) > Number(row.score)).sort((a, b) => Number(a.score) - Number(b.score))[0] : null;
  const below = ranks ? ranked.filter((x) => x.emis !== row.emis && Number(x.score) < Number(row.score)).sort((a, b) => Number(b.score) - Number(a.score))[0] : null;
  const ord = (n: number) => `${n}${["th", "st", "nd", "rd"][(n % 100 >= 11 && n % 100 <= 13) ? 0 : Math.min(n % 10, 4) % 4] ?? "th"}`;
  const line = !ranks ? "Your first scored call puts your school on the table."
    : above ? <>Catch <b>{above.name}</b>: <b>{(Number(above.score) - Number(row.score)).toFixed(1)}</b> points to find.</>
    : below ? <>Top of the table. <b>{below.name}</b> is <b>{(Number(row.score) - Number(below.score)).toFixed(1)}</b> behind. Hold the line.</>
    : "Top of the table. Hold the line.";
  return (
    <div className={`pride${at === 1 ? " lead" : ""}`}>
      <Crest emis={row.emis} path={crest} size={52} />
      <div className="pride-text">
        <span className="pride-kicker">Your school</span>
        <span className="pride-name">{row.name}</span>
        <span className="pride-line">{ranks ? <><strong className="pride-place">{ord(at)}</strong> of {ranked.length} {stage} schools. </> : null}{line}</span>
      </div>
    </div>
  );
}

/** The line under a school's name. Breaks only between parts, never inside one. */
function Meta({ parts }: { parts: (string | null)[] }) {
  const shown = parts.filter(Boolean) as string[];
  return (
    <span className="smeta small muted">
      {shown.map((p, i) => <Fragment key={i}>{i > 0 && " · "}<span>{p}</span></Fragment>)}
    </span>
  );
}
