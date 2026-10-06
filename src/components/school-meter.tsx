"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Crest } from "@/components/crest";
import { useLeague } from "@/components/league";
import { readCache, writeCache } from "@/lib/cache";
import { schoolHref } from "@/lib/crest";
import type { ProjectState } from "@/lib/projects";
import { money } from "@/lib/sponsor";
import { supabase } from "@/lib/supabase";

type Stage = "primary" | "high";
interface Standing { stage: Stage; position: number | null; of: number; score: number | null; confirmed: number; members: number }
interface Given { committed_minor: number; paid_minor: number }
interface Proj { id: number; title: string; state: ProjectState; target_minor: number; pledged_minor: number; paid_minor: number; backers: number }
interface Page { school: { emis: string; name: string }; crest_path: string | null; standing: Standing[]; given: Given | null; projects: Proj[] }
interface Mine { stage: Stage; page: Page }

/** Confirmed players a school needs in a round for it to count on the school table (school_round_minimum()). */
const MINIMUM = 10;

/**
 * What playing does for your school, in real numbers only: what a project it
 * needs has been backed and paid, what sponsors have given it, and until
 * there's money, how close it is to counting on the school table. Never a
 * pledge shown as cash, never an estimate.
 */
export function SchoolMeter() {
  const { me, season } = useLeague();
  const key = `schoolmeter1:${me.user_id}:${season.id}`;
  const [mine, setMine] = useState<Mine[] | null>(() => readCache<Mine[]>(key) ?? null);

  useEffect(() => {
    setMine(readCache<Mine[]>(key) ?? null);
    (async () => {
      const { data } = await supabase.from("member_schools").select("stage, emis").eq("user_id", me.user_id);
      const saved = ((data ?? []) as { stage: Stage; emis: string }[])
        .sort((a, b) => (a.stage === b.stage ? 0 : a.stage === "high" ? -1 : 1));
      const pages = await Promise.all(saved.map((s) => supabase.rpc("school_page", { p_emis: s.emis, p_season: season.id })));
      const rows = saved.map((s, i) => ({ stage: s.stage, page: pages[i].data as Page | null }))
        .filter((r): r is Mine => !!r.page);
      writeCache(key, rows); setMine(rows);
    })();
  }, [key, me.user_id, season.id]);

  if (!mine || !mine.length) return null;
  return (
    <div className="card smeter">
      <h2>Playing for your school</h2>
      {mine.map((m) => <SchoolLine key={`${m.stage}:${m.page.school.emis}`} m={m} />)}
      <p className="small muted smeter-foot">Only money that has really been given shows here. <Link href="/giving/">Every rand, school by school</Link></p>
    </div>
  );
}

function SchoolLine({ m }: { m: Mine }) {
  const s = m.page.school;
  const proj = m.page.projects.find((p) => p.state === "open" || p.state === "funded" || p.state === "ordered");
  const given = m.page.given?.committed_minor ?? 0;
  const st = m.page.standing.find((x) => x.stage === m.stage);
  const confirmed = st?.confirmed ?? 0;

  let bar: number, line: React.ReactNode, sub: React.ReactNode;
  if (proj) {
    bar = proj.target_minor ? proj.pledged_minor / proj.target_minor : 0;
    line = <><b>{money(proj.pledged_minor)}</b> of {money(proj.target_minor)} backed for {proj.title}</>;
    sub = proj.paid_minor > 0 ? `${money(proj.paid_minor)} paid so far, by ${proj.backers} ${proj.backers === 1 ? "backer" : "backers"}.`
      : `${proj.backers} ${proj.backers === 1 ? "backer" : "backers"} so far. Nobody pays until it's fully backed.`;
  } else if (given > 0) {
    const paid = m.page.given?.paid_minor ?? 0;
    bar = given ? paid / given : 0;
    line = <><b>{money(given)}</b> given by sponsors</>;
    sub = `${money(paid)} of it paid to the school so far.`;
  } else {
    bar = confirmed / MINIMUM;
    line = confirmed >= MINIMUM
      ? <><b>{confirmed}</b> confirmed players{st?.position ? <>, {ordinal(st.position)} of {st.of} on the school table</> : null}</>
      : <><b>{confirmed} of {MINIMUM}</b> confirmed players</>;
    sub = confirmed >= MINIMUM
      ? "Nothing given yet. A school with players calling every week is what sponsors back."
      : `At ${MINIMUM}, it scores on the school table every round. Nothing given yet.`;
  }
  const pct = Math.max(0, Math.min(100, Math.round(bar * 100)));
  return (
    <Link href={schoolHref(s.emis)} className="smeter-row">
      <Crest emis={s.emis} path={m.page.crest_path} size={36} name={s.name} />
      <span className="smeter-body">
        <strong className="smeter-name">{s.name}</strong>
        <span className="smeter-line">{line}</span>
        <span className="proj-bar" aria-label={`${pct}%`}><span style={{ width: `${pct}%` }} /></span>
        <span className="small muted">{sub}</span>
      </span>
    </Link>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
