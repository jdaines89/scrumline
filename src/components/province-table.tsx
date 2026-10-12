"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { useLeague } from "@/components/league";
import { ProvinceScene } from "@/components/province-scene";
import { provinceName, schoolHref } from "@/lib/crest";
import { readCache, writeCache } from "@/lib/cache";
import { supabase } from "@/lib/supabase";

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
  const waiting = ALL.filter((p) => !have.has(p)).sort((a, b) => provinceName(a).localeCompare(provinceName(b)));

  return (
    <>
      <div className="stage-tabs" role="tablist" aria-label="School stage">
        {(["high", "primary"] as const).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={stage === s} className={stage === s ? "on" : ""} onClick={() => setStage(s)}>
            {s === "high" ? "High schools" : "Primary schools"}
          </button>
        ))}
      </div>
      {rows === null ? (
        <ol className="board" aria-busy="true" aria-label="Loading the table">
          {[0, 1, 2].map((i) => <li key={i} className="skeleton" style={{ height: 66 }} />)}
        </ol>
      ) : (
        <>
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
      <p className="small muted" style={{ marginTop: 12 }}>
        Every school scores what it does on the Schools table. A province scores the average of its best {TEAM} schools,
        so a province with more schools isn&apos;t ahead just for being big. A school counts once one of its players has
        scored. Tap a province for its top schools.
      </p>
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
