"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProjectCard, type Business } from "@/components/project-card";
import { isBusinessSession, isSchoolSession } from "@/lib/account";
import { useProjects } from "@/lib/projects";
import { money } from "@/lib/sponsor";
import { supabase } from "@/lib/supabase";

/** Who is looking: the businesses they run, and their own name if they're a player. */
function useBacker(): { businesses: Business[] | null; asMe: string | null } {
  const [businesses, setBusinesses] = useState<Business[] | null>(null);
  const [asMe, setAsMe] = useState<string | null>(null);
  useEffect(() => {
    supabase.rpc("my_businesses").then(({ data }) => setBusinesses((data ?? []) as Business[]));
    supabase.auth.getSession().then(async ({ data }) => {
      const s = data.session;
      if (!s || isBusinessSession(s) || isSchoolSession(s)) return;
      const { data: m } = await supabase.from("members").select("display_name").eq("user_id", s.user.id).maybeSingle();
      if (m?.display_name) setAsMe(m.display_name as string);
    });
  }, []);
  return { businesses, asMe };
}

/** School projects on the Giving page: your schools' first, then open ones, then finished. */
export function ProjectsSection() {
  const [projects, reload] = useProjects();
  const { businesses, asMe } = useBacker();
  const list = [...(projects ?? [])].sort((a, b) => Number(b.my_school) - Number(a.my_school));
  return (
    <section id="projects">
      <div className="card narrow">
        <p className="sp-kicker">School projects</p>
        <h2>Things schools need, at a fixed price</h2>
        <p className="sub">Each project is one thing a school needs, like match balls or a water tank, at a supplier&apos;s fixed price. Businesses and players pledge until the full amount is covered. Only then does anyone pay. The items are bought and a photo is posted when they arrive. Each project shows the supplier&apos;s price and Scrumline&apos;s project fee separately.</p>
        {projects === null && <div className="skeleton" style={{ height: 80 }} />}
        {projects?.length === 0 && <p className="muted" style={{ marginBottom: 0 }}>No projects yet. The first ones are on their way.</p>}
      </div>
      {list.map((p) => <ProjectCard key={p.id} p={p} businesses={businesses} asMe={asMe} onChange={reload} />)}
    </section>
  );
}

/** A one-line nudge on Pools when one of your schools has a project open. */
export function SchoolProjectLine() {
  const [projects] = useProjects();
  const p = projects?.find((x) => x.my_school && x.state === "open");
  if (!p) return null;
  return (
    <Link href="/giving/#projects" className="card proj-line">
      <span className="small muted">{p.school} needs</span>
      <strong>{p.title}</strong>
      <span className="small">{money(p.pledged_minor, p.currency)} of {money(p.target_minor, p.currency)} pledged · Back it</span>
    </Link>
  );
}
