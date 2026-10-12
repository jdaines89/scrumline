"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { useLeague } from "@/components/league";
import { ProvinceScene } from "@/components/province-scene";
import { provinceName, schoolHref } from "@/lib/crest";
import { readCache, writeCache } from "@/lib/cache";
import { supabase } from "@/lib/supabase";
import { Tabs } from "@/components/tabs";
import { GroundRules } from "@/components/ground-rules";

type Stage = "high" | "primary";
interface ProvinceRow {
  province: string; schools: number; players: number; mine: boolean; score: number;
  top: { emis: string; name: string; town: string | null; score: number; mine: boolean }[];
}
const TEAM = 50;
const ALL = ["EC", "FS", "GP", "KZN", "LP", "MP", "NC", "NW", "WC"];

/**
 * Provinces against each other, by their schools. A school scores what it does
 * on the Schools table; a province scores the average of its best 50 schools,
 * so a province with more schools isn't ahead just for being big. High and
 * primary schools are ranked apart. Matches public.province_table().
 */
export function ProvinceTable() {
  const { season } = useLeague();
  const [stage, setStage] = useState<Stage>("high");
  const key = `provinces2:${season.id}:${stage}`;
  const [rows, setRows] = useState<ProvinceRow[] | null>(() => readCache<ProvinceRow[]>(key) ?? null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    setRows(readCache<ProvinceRow[]>(key) ?? null);
    setOpen(null);
    supabase.rpc("province_table", { p_season: season.id, p_stage: stage })
      .then(({ data, error }) => { if (error) return; const r = (data ?? []) as ProvinceRow[]; writeCache(key, r); setRows(r); });
  }, [key, season.id, stage]);

  const ranked = (rows ?? []).slice()
    .sort((a, b) => Number(b.score) - Number(a.score) || b.schools - a.schools || provinceName(a.province).localeCompare(provinceName(b.province)));
  const have = new Set(ranked.map((r) => r.province));
  const mine = ranked.find((r) => r.mine);
  const waiting = ALL.filter((p) => !have.has(p)).sort((a, b) => provinceName(a).localeCompare(provinceName(b)));

  return (
    <>
      <Tabs size="sub" label="School stage" items={[["high", "High schools"], ["primary", "Primary schools"]] as const} value={stage} onPick={setStage} />
      {rows === null ? (
        <ol className="board" aria-busy="true" aria-label="Loading the table">
          {[0, 1, 2].map((i) => <li key={i} className="skeleton" style={{ height: 66 }} />)}
        </ol>
      ) : (
        <>
          {mine && <ProvincePride row={mine} ranked={ranked} stage={stage} />}
          {ranked.length > 0 && (
            <ol className="board schools-table provinces">
              {ranked.map((r) => {
                const place = 1 + ranked.filter((x) => Number(x.score) > Number(r.score)).length;
                return (
                <li key={r.province} className={[r.mine ? "me" : "", place <= 3 ? `p${place}` : ""].filter(Boolean).join(" ")}>
                  <div className="srow">
                    <ProvinceScene code={r.province} />
                    <span className="rank">{place}</span>
                    <span className="sname">{provinceName(r.province)}</span>
                    <span className="btotal">{Number(r.score).toFixed(1)}</span>
                    <Meta parts={[`${r.schools.toLocaleString("en-ZA")} ${r.schools === 1 ? "school" : "schools"}`, `${r.players.toLocaleString("en-ZA")} ${r.players === 1 ? "player" : "players"}`]} />
                    <button type="button" className="sch-how-btn srow-how" aria-expanded={open === r.province}
                      onClick={() => setOpen(open === r.province ? null : r.province)}>
                      Top schools
                      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" className={open === r.province ? "up" : ""}><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                  </div>
                  {open === r.province && (
                    <div className="sch-how-body">
                      <ol className="sch-how-list">
                        {r.top.map((s) => (
                          <li key={s.emis} className={s.mine ? "me" : ""}>
                            <div><Link href={schoolHref(s.emis)} className="sch-link">{s.name}</Link>{s.town && <span className="small muted">{s.town}</span>}</div>
                            <div className="sch-how-nums"><b>{Number(s.score).toFixed(1)}</b></div>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </li>
                );
              })}
            </ol>
          )}
          {waiting.length > 0 && (
            <>
              {ranked.length > 0 && <p className="small muted school-waiting">Not ranked yet</p>}
              <ol className="board schools-table provinces waiting">
                {waiting.map((p) => (
                  <li key={p}>
                    <div className="srow">
                      <ProvinceScene code={p} />
                      <span className="rank blank" aria-hidden />
                      <span className="sname">{provinceName(p)}</span>
                      <Meta parts={["No school ranked yet"]} />
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}
      <GroundRules title="How provinces climb" lines={[
        ["Every school pulls its weight.", "Each school's score on the Schools table feeds its province."],
        [`The best ${TEAM} schools carry it.`, "So a big province isn't ahead just for being big."],
        ["Get your school on the board.", "One scored call and it counts. Tap a province for its top schools."],
      ]} />
    </>
  );
}

function Meta({ parts }: { parts: string[] }) {
  return (
    <span className="smeta small muted">
      {parts.map((p, i) => <Fragment key={i}>{i > 0 && " · "}<span>{p}</span></Fragment>)}
    </span>
  );
}

/** Your province, up top: where it stands and who it is chasing (or holding off). */
function ProvincePride({ row, ranked, stage }: { row: ProvinceRow; ranked: ProvinceRow[]; stage: Stage }) {
  const score = Number(row.score);
  const at = 1 + ranked.filter((x) => Number(x.score) > score).length;
  const above = ranked.filter((x) => Number(x.score) > score).sort((a, b) => Number(a.score) - Number(b.score))[0];
  const below = ranked.filter((x) => x.province !== row.province && Number(x.score) < score).sort((a, b) => Number(b.score) - Number(a.score))[0];
  const gap = (n: number) => n.toFixed(1);
  const ord = (n: number) => `${n}${["th", "st", "nd", "rd"][(n % 100 >= 11 && n % 100 <= 13) ? 0 : Math.min(n % 10, 4) % 4] ?? "th"}`;
  const line = above ? <>Chasing <b>{provinceName(above.province)}</b>: <b>{gap(Number(above.score) - score)}</b> points to find.</>
    : below ? <>Out in front. <b>{provinceName(below.province)}</b> is <b>{gap(score - Number(below.score))}</b> behind. Hold the line.</>
    : <>Out in front. Hold the line.</>;
  return (
    <div className={`pride${at === 1 ? " lead" : ""}`}>
      <ProvinceScene code={row.province} />
      <div className="pride-text">
        <span className="pride-kicker">Your province · {stage === "high" ? "high" : "primary"} schools</span>
        <span className="pride-name">{provinceName(row.province)}</span>
        <span className="pride-line"><strong className="pride-place">{ord(at)}</strong> of {ranked.length}. {line}</span>
      </div>
    </div>
  );
}
