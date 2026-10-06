"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Avatar } from "@/components/avatar";
import { Crest, CrestUpload } from "@/components/crest";
import { useLeague } from "@/components/league";
import { readCache, writeCache } from "@/lib/cache";
import { provinceName, schoolHref, schoolKind } from "@/lib/crest";
import { ord } from "@/lib/growth";
import { joinLink } from "@/lib/join-link";
import { projectPhotoUrl, STATE_LABEL, type ProjectState } from "@/lib/projects";
import { money } from "@/lib/sponsor";
import { supabase } from "@/lib/supabase";
import type { Member } from "@/lib/types";

interface Player {
  user_id: string; display_name: string; avatar_path: string | null; stage: "primary" | "high";
  last_year: number | null; verified: boolean; pts: number; playing: boolean; mine: boolean;
}
interface Standing { stage: "primary" | "high"; position: number | null; of: number; score: number | null; confirmed: number; members: number }
interface Given { committed_minor: number; paid_minor: number; confirmed_minor: number; sponsors: string[] }
interface Photo { image_path: string; caption: string | null }
interface Proj {
  id: number; title: string; why: string; items: string; state: ProjectState; target_minor: number; deadline: string;
  pledged_minor: number; paid_minor: number; backers: number; photos: Photo[];
}
interface Partner { emis: string; name: string; town: string | null; distance_km: number | null }
interface SchoolInfo {
  emis: string; name: string; town: string | null; province: string; district: string | null; no_fee: boolean;
  quintile: number | null; learners: number | null; offers_primary: boolean; offers_matric: boolean;
}
interface Page {
  school: SchoolInfo; crest_path: string | null; can_set_crest: boolean; claimed: boolean;
  players: Player[]; standing: Standing[]; given: Given | null; projects: Proj[]; partners: Partner[];
}

const MINIMUM = 10;
const SHOW = 12;
const fmt = (n: number) => n.toLocaleString("en-ZA");
/** Learner numbers come from a government list that is a year or so old, so we only ever show a rough figure. */
const about = (n: number) => {
  const step = n < 100 ? 10 : n < 1000 ? 100 : 500;
  return `~${fmt(Math.max(step, Math.round(n / step) * step))}`;
};
const day = (iso: string) => new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });

/** A school's own page: the school, its players, how it's doing, and what has been given to it. */
export default function SchoolPage() {
  const { season } = useLeague();
  const [emis, setEmis] = useState<string | null>(null);
  useEffect(() => { setEmis(new URLSearchParams(window.location.search).get("e")); }, []);
  const key = `schoolpage1:${emis}:${season.id}`;
  const [page, setPage] = useState<Page | null | undefined>(undefined);

  const load = useCallback(() => {
    if (!emis) return;
    supabase.rpc("school_page", { p_emis: emis, p_season: season.id }).then(({ data, error }) => {
      if (error) return;
      const p = (data ?? null) as Page | null;
      if (p) writeCache(key, p);
      setPage(p);
    });
  }, [emis, key, season.id]);
  useEffect(() => {
    if (!emis) return;
    setPage(readCache<Page>(key) ?? undefined);
    load();
  }, [emis, key, load]);

  if (emis === null || page === undefined) return <div className="skeleton" style={{ height: 240 }} />;
  if (!page) return (
    <div className="card narrow">
      <h2>We couldn&apos;t find that school</h2>
      <p className="sub">The link may be wrong. Every school on Scrumline is on the Schools tab of the leaderboard.</p>
      <Link className="btn" href="/leaderboard/">Go to the leaderboard</Link>
    </div>
  );
  return <SchoolView p={page} seasonName={season.name} onChange={load} />;
}

function SchoolView({ p, seasonName, onChange }: { p: Page; seasonName: string; onChange: () => void }) {
  const s = p.school;
  const facts = [
    schoolKind(s),
    s.learners ? `${about(s.learners)} learners` : null,
    s.no_fee ? "No-fee school" : null,
  ].filter(Boolean).join(" · ");
  const place = [s.town, provinceName(s.province)].filter(Boolean).join(", ");
  const playing = p.players.filter((x) => x.playing);

  return (
    <>
      <div className="card narrow sch-hero">
        <div className="sch-crest-slot"><Crest emis={s.emis} path={p.crest_path} size={p.crest_path ? 84 : 52} name={s.name} /></div>
        <h1 className="sch-name">{s.name}</h1>
        {place && <p className="sch-place">{place}</p>}
        <p className="small muted sch-facts">{facts}</p>
        <div className="sch-stats">
          <div><b>{p.players.length}</b><span className="small muted">{p.players.length === 1 ? "player" : "players"} went here</span></div>
          <div><b>{playing.length}</b><span className="small muted">playing the {seasonName}</span></div>
          <div><b>{money(p.given?.committed_minor ?? 0)}</b><span className="small muted">given to the school</span></div>
        </div>
        <ShareSchool name={s.name} seasonName={seasonName} />
        {p.can_set_crest && <CrestUpload emis={s.emis} hasCrest={!!p.crest_path} onDone={onChange} note="Only admins and the school's own contact can change it." />}
      </div>

      <Standings standing={p.standing} seasonName={seasonName} />
      <Players players={p.players} />
      <GivenCard p={p} />
    </>
  );
}

function ShareSchool({ name, seasonName }: { name: string; seasonName: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    supabase.rpc("my_invite").then(({ data }) => setCode(((data ?? []) as { code: string }[])[0]?.code ?? null));
  }, []);
  async function share() {
    const site = `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}`;
    const text = `Play for ${name} on Scrumline in the ${seasonName}. Call the score of every match and climb the schools table, while businesses fund things the school needs. Free to play, no betting.\n\nTap to join: ${joinLink(site, code)}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else await navigator.clipboard.writeText(text);
      setDone(true);
    } catch { /* dismissed */ }
  }
  return (
    <button type="button" className="sch-share" onClick={share}>
      {done ? "Invite ready to send" : "Get old schoolmates playing"}
    </button>
  );
}

function Standings({ standing, seasonName }: { standing: Standing[]; seasonName: string }) {
  if (standing.length === 0) return null;
  return (
    <div className="card narrow">
      <h2>In the schools table</h2>
      <p className="sub">{seasonName}</p>
      <ul className="sch-rows">
        {standing.map((t) => {
          const level = t.stage === "high" ? "high schools" : "primary schools";
          return (
            <li key={t.stage}>
              {t.position !== null ? (
                <>
                  <div><b>{ord(t.position)} of {t.of} {level}</b>
                    <span className="small muted">{t.confirmed} confirmed {t.confirmed === 1 ? "player" : "players"}</span></div>
                  <span className="sch-score">{Number(t.score).toFixed(1)}</span>
                </>
              ) : (
                <div><b>Not ranked yet among {level}</b>
                  <span className="small muted">
                    {t.confirmed < MINIMUM
                      ? `${t.confirmed} of the ${MINIMUM} confirmed players a school needs in one round`
                      : `${t.confirmed} confirmed players; ${MINIMUM} need to play in the same round`}
                  </span></div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="small" style={{ margin: "12px 0 0" }}><Link href="/leaderboard/?tab=schools">See the whole schools table</Link></p>
    </div>
  );
}

function Players({ players }: { players: Player[] }) {
  const [all, setAll] = useState(false);
  if (players.length === 0) return (
    <div className="card narrow">
      <h2>Players</h2>
      <p className="muted" style={{ margin: 0 }}>Nobody has said they went here yet. Went here yourself? Add it on <Link href="/me/">your profile</Link>.</p>
    </div>
  );
  const both = players.some((x) => x.stage === "primary") && players.some((x) => x.stage === "high");
  const shown = all ? players : players.slice(0, SHOW);
  return (
    <div className="card narrow">
      <h2>Players</h2>
      <p className="sub">Everyone on Scrumline who went here. Confirmed means two schoolmates have vouched for them.</p>
      <ol className="sch-players">
        {shown.map((x) => (
          <li key={`${x.user_id}:${x.stage}`} className={x.mine ? "me" : ""}>
            <Avatar member={{ display_name: x.display_name, avatar_path: x.avatar_path } as Member} size={36} />
            <div className="who">
              <strong>{x.display_name}{x.mine ? " (you)" : ""}</strong>
              <span className="small muted">
                {[x.last_year ? `Class of ${x.last_year}` : null, both ? (x.stage === "high" ? "high school" : "primary school") : null,
                  x.verified ? "confirmed" : "not confirmed yet"].filter(Boolean).join(" · ")}
              </span>
            </div>
            <span className={`sch-pts${x.playing ? "" : " muted"}`}>{x.playing ? `${x.pts} pts` : "not playing"}</span>
          </li>
        ))}
      </ol>
      {players.length > SHOW && (
        <button type="button" className="ghost sch-more" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${players.length} players`}
        </button>
      )}
    </div>
  );
}

function GivenCard({ p }: { p: Page }) {
  const s = p.school;
  const g = p.given;
  const projects = p.projects;
  const given = (g?.committed_minor ?? 0) > 0;
  return (
    <div className="card narrow">
      <h2>What&apos;s been given</h2>
      {!given && projects.length === 0 ? (
        <p className="sub" style={{ marginBottom: 12 }}>
          Nothing yet. When a business sponsors a round, part of it goes to schools like {s.name}, and businesses can back
          something the school needs, from rugby balls to reading books.
        </p>
      ) : given && g ? (
        <>
          <div className="school-stats">
            <div><b>{money(g.committed_minor)}</b><span className="small muted">From sponsors</span></div>
            <div><b>{money(g.paid_minor)}</b><span className="small muted">Paid to the school</span></div>
            <div><b>{money(g.confirmed_minor)}</b><span className="small muted">Confirmed by the school</span></div>
          </div>
          {g.sponsors.length > 0 && <p className="small muted">Thanks to {listOf(g.sponsors)}.</p>}
        </>
      ) : null}

      {projects.length > 0 && (
        <ul className="sch-projects">
          {projects.map((x) => <ProjectRow key={x.id} x={x} />)}
        </ul>
      )}

      {p.partners.length > 0 && (
        <div className="sch-partner">
          <span className="small muted">{s.no_fee ? (p.partners.length === 1 ? "Partner school" : "Partner schools") : "Partner school"}</span>
          {p.partners.map((o) => (
            <Link key={o.emis} href={schoolHref(o.emis)} className="sch-partner-row">
                            <span className="sch-partner-text"><b>{o.name}</b>
                {(o.town || o.distance_km !== null) && <span className="small muted">{[o.town, o.distance_km !== null ? `${Math.round(o.distance_km)} km away` : null].filter(Boolean).join(" · ")}</span>}</span>
            </Link>
          ))}
          <span className="small muted">
            {s.no_fee
              ? `Part of what sponsors give ${p.partners.length === 1 ? "this school" : "these schools"} comes to ${s.name}.`
              : `Part of what sponsors give ${s.name} goes to its partner, a no-fee school nearby.`}
          </span>
        </div>
      )}

      {p.claimed && <p className="small muted" style={{ margin: "14px 0 0" }}>{s.name} has claimed its page, so sponsors&apos; money is paid straight to the school.</p>}
      <p className="small" style={{ margin: p.claimed ? "6px 0 0" : "14px 0 0" }}><Link href="/giving/">Every rand given, school by school</Link></p>
    </div>
  );
}

function ProjectRow({ x }: { x: Proj }) {
  const pct = x.target_minor ? Math.min(100, Math.round((x.pledged_minor / x.target_minor) * 100)) : 0;
  return (
    <li>
      {x.photos.length > 0 && <ProjectPhoto photo={x.photos[x.photos.length - 1]} />}
      <div className="sch-proj-body">
        <div className="proj-head">
          <strong>{x.title}</strong>
          <span className={`proj-state ${x.state}`}>{STATE_LABEL[x.state]}</span>
        </div>
        <p className="small muted" style={{ margin: "2px 0 0" }}>{x.items}</p>
        <div className="proj-bar" aria-label={`${pct}% pledged`}><span style={{ width: `${pct}%` }} /></div>
        <div className="proj-nums small">
          <span><b>{money(x.pledged_minor)}</b> of {money(x.target_minor)}</span>
          <span className="muted">
            {x.state === "open" ? `closes ${day(x.deadline)}` : `${x.backers} ${x.backers === 1 ? "backer" : "backers"}`}
          </span>
        </div>
        {x.state === "open" && <Link className="small" href="/giving/">Back this project</Link>}
      </div>
    </li>
  );
}

function ProjectPhoto({ photo }: { photo: Photo }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { projectPhotoUrl(photo.image_path).then(setUrl); }, [photo.image_path]);
  return url ? <img className="sch-proj-photo" src={url} alt={photo.caption ?? ""} /> : <div className="sch-proj-photo skeleton" />;
}

/** "A", "A and B", "A, B and C". */
function listOf(xs: string[]): string {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}
