"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AchBadge } from "@/components/achievement-badge";
import { Avatar } from "@/components/avatar";
import { useLeague } from "@/components/league";
import { SponsorAbout, SponsorTile } from "@/components/sponsor-tile";
import { achievements, type ScoredCall } from "@/lib/achievements";
import { readCache, writeCache } from "@/lib/cache";
import { schoolHref } from "@/lib/crest";
import { fullName } from "@/lib/names";
import { CATEGORIES } from "@/lib/sponsor";
import { supabase } from "@/lib/supabase";
import type { Member } from "@/lib/types";

interface School { stage: "primary" | "high"; emis: string; last_year: number | null; name: string; verified: boolean }
interface Played { season: string; season_name: string; team_name: string; points: number; rank: number; players: number; matches: number; right_results: number }
interface Business { id: number; name: string; category: string; about: string | null; website: string | null; logo_path: string | null }
interface Profile { schools: School[]; record: Played[]; businesses: Business[] }

const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
};
const category = (c: string) => CATEGORIES.find(([k]) => k === c)?.[1] ?? "";

/** Who a player is: their name, schools, businesses and how they've done in every tournament. */
export function PlayerCard({ member, onClose }: { member: Member; onClose: () => void }) {
  const key = `player:${member.user_id}`;
  const [p, setP] = useState<Profile | null>(() => readCache<Profile>(key) ?? null);

  useEffect(() => {
    let live = true;
    Promise.all([
      supabase.from("member_schools").select("stage, emis, last_year, schools(name)").eq("user_id", member.user_id),
      supabase.from("school_members").select("stage, verified").eq("user_id", member.user_id),
      supabase.rpc("player_record", { p_user: member.user_id }),
      supabase.rpc("player_businesses", { p_user: member.user_id }),
    ]).then(([ms, sm, rec, biz]) => {
      if (!live) return;
      const ok = new Map(((sm.data ?? []) as { stage: string; verified: boolean }[]).map((r) => [r.stage, r.verified]));
      const schools = ((ms.data ?? []) as unknown as { stage: "primary" | "high"; emis: string; last_year: number | null; schools: { name: string } | null }[])
        .filter((r) => r.schools)
        .map((r) => ({ stage: r.stage, emis: r.emis, last_year: r.last_year, name: r.schools!.name, verified: !!ok.get(r.stage) }))
        .sort((a, b) => (a.stage === "high" ? -1 : 1) - (b.stage === "high" ? -1 : 1));
      const out = { schools, record: (rec.data ?? []) as Played[], businesses: (biz.data ?? []) as Business[] };
      writeCache(key, out);
      setP(out);
    });
    return () => { live = false; };
  }, [key, member.user_id]);

  // Their calling achievements in the tournament you're looking at. Scored calls are only
  // readable for players who share a league with you, so for anyone else this stays hidden.
  const { season, matches, me } = useLeague();
  const achKey = `player-ach:${member.user_id}:${season.id}`;
  const [calls, setCalls] = useState<ScoredCall[] | null>(() => readCache<ScoredCall[] | null>(achKey) ?? null);
  useEffect(() => {
    let live = true;
    setCalls(readCache<ScoredCall[] | null>(achKey) ?? null);
    (async () => {
      const { data: e } = await supabase.from("entries").select("id").eq("season", season.id).eq("user_id", member.user_id).maybeSingle();
      let rows: ScoredCall[] | null = null;
      if (e) {
        const { data: shared } = member.user_id === me.user_id ? { data: true } : await supabase.rpc("shares_pool", { p_entry: e.id });
        if (shared) {
          const { data } = await supabase.from("prediction_points").select("round, right_result, near_pts, exact_pts, is_banker").eq("entry_id", e.id);
          rows = (data ?? []) as ScoredCall[];
        }
      }
      if (!live) return;
      writeCache(achKey, rows);
      setCalls(rows);
    })();
    return () => { live = false; };
  }, [achKey, member.user_id, me.user_id, season.id]);
  const earned = calls ? achievements(calls, matches).filter((a) => a.earned) : null;

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div className="wip-dim" role="dialog" aria-modal="true" aria-labelledby="pc-name" onClick={onClose}>
      <div className="wip-sheet pc" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="pc-close" aria-label="Close" onClick={onClose}>✕</button>
        <div className="pc-head">
          <Avatar member={member} size={64} />
          <div>
            <h2 id="pc-name">{member.team_name ?? member.display_name}</h2>
            <p className="pc-real">{fullName(member)}</p>
          </div>
        </div>

        {p === null ? <div className="skeleton" style={{ height: 120, marginTop: 16 }} /> : (
          <>
            {p.schools.length > 0 && (
              <section>
                <h3>Schools</h3>
                <ul className="pc-list">
                  {p.schools.map((s) => (
                    <li key={s.stage} className="pc-schoolrow">
                      <Link href={schoolHref(s.emis)} className="pc-school" onClick={onClose}>
                        <span>{s.name}{s.verified && <span className="pc-ok" title="Confirmed by schoolmates"> ✓</span>}</span>
                        <span className="pc-go">
                          {s.last_year && <span className="muted">{s.stage === "high" ? "Matric" : "Completed"} {s.last_year}</span>}
                          <span className="pc-chev" aria-hidden="true">›</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {p.businesses.length > 0 && (
              <section>
                <h3>{p.businesses.length === 1 ? "Business" : "Businesses"}</h3>
                {p.businesses.map((b) => (
                  <div key={b.id} className="pc-biz">
                    <div className="pc-bizhead">
                      <SponsorTile name={b.name} logo={b.logo_path} />
                      <div><strong>{b.name}</strong><span className="small muted">{category(b.category)}</span></div>
                    </div>
                    <SponsorAbout about={b.about} website={b.website} />
                  </div>
                ))}
              </section>
            )}

            {earned && (
              <section>
                <h3>Achievements</h3>
                {earned.length === 0 ? <p className="small muted">None unlocked yet in {season.name}.</p> : (
                  <ul className="pc-ach">
                    {earned.map((a) => (
                      <li key={a.key} title={a.rule}>
                        <AchBadge k={a.key} have={a.have} goal={a.goal} earned size={48} />
                        <span>{a.title}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            <section>
              <h3>Tournaments</h3>
              {p.record.length === 0 ? <p className="small muted">Hasn&apos;t played a tournament yet.</p> : (
                <ul className="pc-list">
                  {p.record.map((r) => (
                    <li key={r.season}>
                      <span>{r.season_name}<span className="small muted pc-sub">{r.matches ? `${r.right_results} of ${r.matches} right` : "No calls scored yet"}</span></span>
                      <span className="pc-rank">
                        <strong>{r.points} pts</strong>
                        <span className="small muted">{r.matches ? `${ordinal(r.rank)} of ${r.players}` : `${r.players} playing`}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
