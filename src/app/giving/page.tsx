"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProjectsSection } from "@/components/projects-section";
import { SponsorAbout, SponsorTile } from "@/components/sponsor-tile";
import { readCache, writeCache } from "@/lib/cache";
import { SAMPLE_GIVING, usePreview } from "@/lib/preview";
import { money } from "@/lib/sponsor";
import { useSponsorSeason } from "@/lib/sponsor-season";
import { supabase } from "@/lib/supabase";

interface Totals { committed_minor: number; paid_minor: number; confirmed_minor: number; schools: number; sponsors: number }
interface SchoolRow { emis: string | null; name: string; town: string | null; no_fee: boolean; committed_minor: number; paid_minor: number | null; confirmed_minor: number | null; sponsors: string[] }
interface SponsorRow { sponsor: string; category: string; to_schools_minor: number; schools: number; logo_path: string | null; about: string | null; website: string | null }
interface Giving { totals: Totals | null; schools: SchoolRow[]; sponsors: SponsorRow[] }

const ALL = "all";

/**
 * Where sponsors' money went, in the open: every rand promised to schools,
 * how much has been paid out, and how much the schools have confirmed.
 */
export default function GivingPage() {
  const { seasons } = useSponsorSeason();
  const [season, setSeason] = useState(ALL);
  const [view, setView] = useState<"schools" | "sponsors">("schools");
  const [open, setOpen] = useState<number | null>(null);
  const key = `giving2:${season}`;
  const [real, setG] = useState<Giving | null>(() => readCache<Giving>(key) ?? null);
  const preview = usePreview();
  const g: Giving | null = preview ? SAMPLE_GIVING : real;

  useEffect(() => {
    setG(readCache<Giving>(key) ?? null);
    const p = { p_season: season === ALL ? null : season };
    Promise.all([supabase.rpc("giving_totals", p), supabase.rpc("giving_schools", p), supabase.rpc("giving_sponsors", p)])
      .then(([t, s, sp]) => {
        const fresh: Giving = { totals: ((t.data ?? []) as Totals[])[0] ?? null, schools: (s.data ?? []) as SchoolRow[], sponsors: (sp.data ?? []) as SponsorRow[] };
        writeCache(key, fresh); setG(fresh);
      });
  }, [key, season]);

  const t = g?.totals;
  return (
    <>
      <div className="card narrow">
        <p className="sp-kicker">Giving</p>
        <h2>Where sponsors&apos; money goes</h2>
        <p className="sub">Every rand businesses have given schools through Scrumline, school by school. Paid means sent to the school; confirmed means the school has said it arrived.</p>
        {seasons.length > 0 && (
          <label className="sp-season">
            <span className="small muted">Tournament</span>
            <select value={season} onChange={(e) => setSeason(e.target.value)}>
              <option value={ALL}>All tournaments</option>
              {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}
        {g === null ? <div className="skeleton" style={{ height: 70 }} /> : (
          <div className="give-stats">
            <div><b>{money(t?.committed_minor ?? 0)}</b><span>to schools</span></div>
            <div><b>{money(t?.paid_minor ?? 0)}</b><span>paid so far</span></div>
            <div><b>{money(t?.confirmed_minor ?? 0)}</b><span>confirmed</span></div>
          </div>
        )}
      </div>

      <div className="card narrow">
        <div className="seg sm" role="tablist" aria-label="Show">
          {(["schools", "sponsors"] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? "on" : ""} onClick={() => setView(v)}>
              {v === "schools" ? `Schools${t ? ` (${t.schools})` : ""}` : `Sponsors${t ? ` (${t.sponsors})` : ""}`}
            </button>
          ))}
        </div>
        {g === null ? <div className="skeleton" style={{ height: 120 }} /> :
          (view === "schools" ? g.schools.length : g.sponsors.length) === 0 ? (
            <p className="muted" style={{ marginBottom: 0 }}>Nothing yet. When a business backs a school, every rand shows up here.</p>
          ) : view === "schools" ? (
            <ol className="give-list">
              {g.schools.map((r, i) => (
                <li key={r.emis ?? "fund"}>
                  <span className="rank">{i + 1}</span>
                  <div className="who">
                    <strong>{r.name}</strong>
                    <span className="small muted">{[r.town, r.no_fee && r.emis ? "no-fee school" : null, r.sponsors.length ? `from ${r.sponsors.join(", ")}` : null].filter(Boolean).join(" · ")}</span>
                  </div>
                  <div className="amt"><b>{money(r.committed_minor)}</b>
                    <span className="small muted">{r.confirmed_minor ? `${money(r.confirmed_minor)} confirmed` : r.paid_minor ? `${money(r.paid_minor)} paid` : "not paid yet"}</span></div>
                </li>
              ))}
            </ol>
          ) : (
            <ol className="give-list">
              {g.sponsors.map((r, i) => (
                <li key={`${r.sponsor}-${i}`} className={open === i ? "open" : ""}>
                  <span className="rank">{i + 1}</span>
                  <SponsorTile name={r.sponsor} logo={r.logo_path} />
                  <div className="who">
                    {r.about || r.website
                      ? <button type="button" className="linkish sp-name" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}><strong>{r.sponsor}</strong></button>
                      : <strong>{r.sponsor}</strong>}
                    <span className="small muted">{r.schools} school{r.schools === 1 ? "" : "s"}</span>
                    {open === i && <SponsorAbout about={r.about} website={r.website} />}
                  </div>
                  <div className="amt"><b>{money(r.to_schools_minor)}</b><span className="small muted">to schools</span></div>
                </li>
              ))}
            </ol>
          )}
      </div>
      <ProjectsSection />
      <p className="small muted center">Every sponsorship includes a donation of 40% of its price, half to the school and half to a no-fee school near it, and sponsors can add more on top. Scrumline takes nothing from donations. School projects show the supplier&apos;s price and Scrumline&apos;s project fee as separate amounts. <Link href="/sponsor/">Back a school</Link></p>
    </>
  );
}
