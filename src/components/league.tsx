"use client";

import { readCache, writeCache } from "@/lib/cache";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { SponsorTabs } from "@/components/sponsor-tabs";
import { isBusinessSession, isPublicPath, isSchoolPath, isSchoolSession, isSponsorPath } from "@/lib/account";
import { supabase } from "@/lib/supabase";
import type { Competition, Entry, Match, Member, Pool, Season, Team } from "@/lib/types";
import { poolLabel } from "@/components/pool-name";
import { WhoIsPlaying } from "@/components/who-is-playing";
import { callsToSave, readPendingCalls, writePendingCalls } from "@/lib/pending-calls";
import { SchoolStep } from "@/components/school-step";
import { needsNames } from "@/lib/names";
import { defaultSeason, pickerGroups, seasonLine } from "@/lib/seasons";

interface League {
  seasons: Season[];
  competitions: Map<string, Competition>;
  season: Season;
  setSeason: (id: string) => void;
  pools: Pool[];
  pool: Pool | null;
  setPool: (id: number) => void;
  reloadPools: () => Promise<void>;
  teams: Map<string, Team>;
  matches: Match[];
  rounds: number[];
  me: Member;
  members: Member[];
  entry: Entry | null;
  reloadEntry: () => Promise<void>;
}

const Ctx = createContext<League | null>(null);

export function useLeague(): League {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLeague outside <LeagueProvider>");
  return v;
}

interface Base { seasons: Season[]; competitions: Map<string, Competition>; teams: Map<string, Team>; me: Member; members: Member[] }
interface CachedBase { seasons: Season[]; competitions: Competition[]; teams: Team[]; me: Member; members: Member[] }
interface SeasonData { matches: Match[]; entry: Entry | null; pools: Pool[] }

function hydrate(b: CachedBase): Base {
  return { ...b, competitions: new Map(b.competitions.map((c) => [c.id, c])), teams: new Map(b.teams.map((t) => [t.id, t])) };
}

/**
 * Which of a tournament's tables to show: the same league you were just in
 * (leagues play every tournament), else the one you last opened there, else the first.
 */
function pickPool(ps: Pool[], sid: string, current: Pool | null): number | null {
  const league = (p: Pool) => p.league_id ?? p.id;
  if (current) {
    if (ps.some((p) => p.id === current.id)) return current.id;
    const same = ps.find((p) => league(p) === league(current));
    if (same) return same.id;
  }
  const saved = Number(remember(`pool:${sid}`));
  return ps.some((p) => p.id === saved) ? saved : ps[0]?.id ?? null;
}

function remember(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch { return null; }
}


/**
 * Loads what every screen needs after sign-in: who you are, the tournaments,
 * the one you're looking at (remembered per device) with its fixtures, your
 * entry for it, and the pools you're in for it.
 */
export function LeagueProvider({ children }: { children: ReactNode }) {
  const path = usePathname();
  if (isPublicPath(path)) return <>{children}</>;
  return <Loaded>{children}</Loaded>;
}

/** A business account only has the sponsor pages; any other address takes it there. */
function BusinessOnly({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const ok = isSponsorPath(path);
  useEffect(() => { if (!ok) router.replace("/sponsor/results/"); }, [ok, router]);
  return ok ? <>{children}</> : <p className="muted">Loading&hellip;</p>;
}

/** A school account only has its school's pages. */
function SchoolOnly({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const ok = isSchoolPath(path);
  useEffect(() => { if (!ok) router.replace("/school/"); }, [ok, router]);
  return ok ? <>{children}</> : <p className="muted">Loading&hellip;</p>;
}

function Loaded({ children }: { children: ReactNode }) {
  const [business, setBusiness] = useState(false);
  const [schoolOnly, setSchoolOnly] = useState(false);
  const [base, setBase] = useState<Base | null>(null);
  const [seasonId, setSeasonId] = useState<string | null>(null);
  // The tournament asked for last, so a slow answer for one you've since left can't overwrite it.
  const wanted = useRef<string | null>(null);
  const [data, setData] = useState<SeasonData | null>(null);
  const [poolId, setPoolId] = useState<number | null>(null);
  // The league on screen, so switching tournament stays in it rather than flashing "No league yet".
  const shownPool = useRef<Pool | null>(null);
  shownPool.current = data?.pools.find((p) => p.id === poolId) ?? null;
  const show = (sid: string) => { wanted.current = sid; setSeasonId(sid); };
  // Only ask "Who's playing?" once the real member row is in, never off last visit's copy.
  const [fresh, setFresh] = useState(false);
  // Whether you've saved a school; the school question comes once, after your name, only if not.
  const [hasSchool, setHasSchool] = useState(true);

  // Draw from last visit's copy straight away; the fetches below replace it.
  useEffect(() => {
    const b = readCache<CachedBase>("base");
    if (!b) return;
    setBase(hydrate(b));
    const saved = remember("season");
    const sid = b.seasons.some((s) => s.id === saved) ? saved! : defaultSeason(b.seasons).id;
    {
      // A notification's pool link is sorted out once the fresh data arrives.
      if (new URLSearchParams(window.location.search).get("pool")) return;
      show(sid);
      const d = readCache<SeasonData>(`season:${sid}`);
      if (d) { setData(d); setPoolId(pickPool(d.pools, sid, null)); }
    }
  }, []);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      // The session is already on this device, so no round trip is needed to know who you are.
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (isBusinessSession(sess.session)) { setBusiness(true); return; }
      if (isSchoolSession(sess.session)) { setSchoolOnly(true); return; }
      const [seasons, comps, teams, members, schools] = await Promise.all([
        supabase.from("seasons").select("*").order("starts_on", { ascending: false, nullsFirst: false }),
        supabase.from("competitions").select("*"),
        supabase.from("teams").select("id, display_name, short_name, stadium, colour, colour_ink, badge_url"),
        supabase.from("members").select("*").order("display_name"),
        supabase.from("member_schools").select("stage").eq("user_id", uid ?? ""),
      ]);
      const everyone = (members.data ?? []) as Member[];
      const me = everyone.find((m) => m.user_id === uid);
      const ss = (seasons.data ?? []) as Season[];
      if (!me) { setError("Your account isn't a member of this league. Ask Justin for an invite."); return; }
      if (!ss.length) { setError("No season has been loaded yet."); return; }
      const fresh: CachedBase = { seasons: ss, me, members: everyone,
        competitions: (comps.data ?? []) as Competition[], teams: (teams.data ?? []) as Team[] };
      writeCache("base", fresh);
      setBase(hydrate(fresh));
      setHasSchool(!!schools.error || (schools.data ?? []).length > 0);
      setFresh(true);
      // A tapped notification links to one pool (?pool=4): open its tournament and pool.
      const linked = Number(new URLSearchParams(window.location.search).get("pool"));
      if (linked) {
        const { data: lp } = await supabase.from("pools").select("id, season").eq("id", linked).maybeSingle();
        if (lp) { remember("season", lp.season); remember(`pool:${lp.season}`, String(lp.id)); }
        window.history.replaceState(null, "", window.location.pathname);
      }
      // A newcomer's first visit opens the tournament they called on the invite link.
      const saved = remember("season") ?? readPendingCalls()?.season ?? null;
      show(ss.some((s) => s.id === saved) ? saved! : defaultSeason(ss).id);
    })();
  }, []);

  // Fetched just now by a tournament switch, so the effect below needn't fetch it again.
  const justLoaded = useRef<string | null>(null);
  const shownSeason = useRef<string | null>(null);
  shownSeason.current = seasonId;
  const loadSeason = useCallback(async (sid: string | null = seasonId) => {
    if (!base || !sid) return;
    const seasonId = sid;
    const [matches, entries, pools] = await Promise.all([
      supabase.from("matches").select("*").eq("season", seasonId).order("kickoff_at"),
      supabase.from("entries").select("*").eq("season", seasonId).eq("user_id", base.me.user_id),
      supabase.from("pools").select("*").eq("season", seasonId).order("created_at"),
    ]);
    const ps = (pools.data ?? []) as Pool[];
    const entry = (entries.data?.[0] as Entry | undefined) ?? null;
    // Calls made on an invite link before signing up go in once there's a team to hold them.
    const waiting = entry ? callsToSave(readPendingCalls(), seasonId) : [];
    if (entry && waiting.length) {
      const { error } = await supabase.from("predictions").upsert(waiting.map((c) => ({ entry_id: entry.id, ...c })), { onConflict: "entry_id,match_id", ignoreDuplicates: true });
      if (!error) writePendingCalls(null);
    } else if (entry && readPendingCalls()?.season === seasonId) writePendingCalls(null);
    const fresh: SeasonData = { matches: (matches.data ?? []) as Match[], entry, pools: ps };
    writeCache(`season:${seasonId}`, fresh);
    if (wanted.current !== seasonId) return;
    if (shownSeason.current !== seasonId) justLoaded.current = seasonId;
    setData(fresh);
    setPoolId(pickPool(ps, seasonId, shownPool.current));
    setSeasonId(seasonId);
  }, [base, seasonId]);
  useEffect(() => {
    if (justLoaded.current && justLoaded.current === seasonId) { justLoaded.current = null; return; }
    loadSeason();
  }, [loadSeason, seasonId]);
  const reload = useCallback(() => loadSeason(), [loadSeason]);

  if (business) return <BusinessOnly>{children}</BusinessOnly>;
  if (schoolOnly) return <SchoolOnly>{children}</SchoolOnly>;
  if (error) return <div className="notice">{error}</div>;
  if (!base || !seasonId || !data) return <p className="muted">Loading the league&hellip;</p>;

  const season = base.seasons.find((s) => s.id === seasonId)!;
  const value: League = {
    ...base, season,
    // Switch in one step: the new tournament's league is picked before anything redraws.
    // With nothing saved for it yet, the screen stays as it is until its data arrives.
    setSeason: (id) => {
      if (id === seasonId) return;
      remember("season", id);
      wanted.current = id;
      const d = readCache<SeasonData>(`season:${id}`);
      if (!d) { loadSeason(id); return; }
      const p = pickPool(d.pools, id, shownPool.current);
      if (p !== null) remember(`pool:${id}`, String(p));
      setData(d); setPoolId(p); setSeasonId(id);
    },
    pools: data.pools,
    pool: data.pools.find((p) => p.id === poolId) ?? null,
    setPool: (id) => { remember(`pool:${seasonId}`, String(id)); setPoolId(id); },
    reloadPools: reload,
    matches: data.matches,
    rounds: [...new Set(data.matches.map((m) => m.round))].sort((a, b) => a - b),
    entry: data.entry,
    reloadEntry: reload,
  };
  // Saved names come back with the short name the database worked out; the entry's team name follows on the server.
  function named(m: Member) {
    const members = base!.members.map((x) => (x.user_id === m.user_id ? m : x));
    const cached = readCache<CachedBase>("base");
    if (cached) writeCache("base", { ...cached, me: m, members });
    setBase({ ...base!, me: m, members });
    loadSeason();
  }
  return (
    <Ctx.Provider value={value}>
      <Switcher />
      {children}
      {fresh && needsNames(base.me) && <WhoIsPlaying me={base.me} members={base.members} onDone={named} />}
      {fresh && !needsNames(base.me) && !hasSchool && !base.me.school_asked_at && (
        <SchoolStep me={base.me} onJoined={loadSeason} onDone={named} />
      )}
    </Ctx.Provider>
  );
}

// Only these screens show one pool's view; everywhere else the pool picker is noise.
// Pools are picked on the Leagues screen now, so no screen shows a pool dropdown.
const POOL_SCREENS: string[] = [];

/** Which tournament you're looking at, and on pool screens which pool. */
function Switcher() {
  const { seasons, season, setSeason, pools, pool, setPool } = useLeague();
  const path = usePathname() ?? "";
  const [picking, setPicking] = useState(false);
  if (isSponsorPath(path)) return <SponsorTabs />;
  // Chat picks its pool in its own header, so the conversation gets the screen.
  if (isSchoolPath(path) || path.startsWith("/admin") || path.startsWith("/chat")) return null;
  const showPool = POOL_SCREENS.some((p) => path.startsWith(p));
  return (
    <div className="switcher">
      {seasons.length > 1 ? (
        <>
          <button type="button" className="season-pick" onClick={() => setPicking(true)} aria-haspopup="dialog">
            <span className="season-pick-kicker">Tournament</span>
            <span className="season-pick-box">
              <span className="season-pick-name">{season.name}{season.is_replay ? " (replay)" : ""}</span>
              <span className="season-pick-change" aria-hidden="true">
                Change
                <svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
            </span>
          </button>
          {picking && <TournamentSheet onClose={() => setPicking(false)} />}
        </>
      ) : (
        <div className="season-pick">
          <span className="season-pick-kicker">Tournament</span>
          <span className="season-pick-name">{season.name}{season.is_replay ? " (replay)" : ""}</span>
        </div>
      )}
      {showPool && <label>
        <span>League</span>
        {pools.length ? (
          <select value={pool?.id ?? ""} onChange={(e) => setPool(Number(e.target.value))}>
            {pools.map((p) => <option key={p.id} value={p.id}>{poolLabel(p)}</option>)}
          </select>
        ) : <Link href="/leagues/" className="nopool">Start or join a league</Link>}
      </label>}
    </div>
  );
}

/**
 * Picking a tournament: a calm sheet grouped into what's on now, coming up,
 * finished and practice, each with one line saying when it runs.
 */
function TournamentSheet({ onClose }: { onClose: () => void }) {
  const { seasons, season, setSeason } = useLeague();
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="wip-dim" onClick={onClose}>
      <div className="wip-sheet tsheet" role="dialog" aria-modal="true" aria-labelledby="tsheet-title" onClick={(e) => e.stopPropagation()}>
        <div className="tsheet-head">
          <h2 id="tsheet-title">Choose a tournament</h2>
          <button type="button" className="ghost tsheet-done" onClick={onClose}>Done</button>
        </div>
        {pickerGroups(seasons, season.id).map((g) => (
          <section key={g.label} className="tsheet-group">
            <h3>{g.label}</h3>
            {g.seasons.map((s) => {
              const on = s.id === season.id;
              return (
                <button key={s.id} type="button" className={on ? "tsheet-row on" : "tsheet-row"} aria-current={on ? "true" : undefined}
                  onClick={() => { if (!on) setSeason(s.id); onClose(); }}>
                  <span className="tsheet-text">
                    <span className="tsheet-name">{s.name}</span>
                    {seasonLine(s) && <span className="tsheet-when">{seasonLine(s)}</span>}
                  </span>
                  {on && <svg className="tsheet-tick" viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </button>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}

/** Screens that need a pool: points the way to one when you have none. */
export function NeedsPool({ children }: { children: ReactNode }) {
  const { pool, season } = useLeague();
  if (pool) return <>{children}</>;
  return (
    <div className="card narrow">
      <h2>No league yet</h2>
      <p className="sub">You&apos;re not in a league for {season.name}. Start one or join with a code from a mate.</p>
      <Link className="btn" href="/leagues/">Go to leagues</Link>
    </div>
  );
}

export function NeedsEntry({ children }: { children: ReactNode }) {
  const { entry, season, reloadEntry, me } = useLeague();
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  // Everyone has one team name now, so joining a tournament needs no questions.
  useEffect(() => {
    if (entry || !me.team_name) return;
    supabase.from("entries").insert({ season: season.id, team_name: me.team_name, user_id: me.user_id })
      .then(({ error }) => (error ? setMsg(error.message) : reloadEntry()));
  }, [entry, me.team_name, me.user_id, season.id, reloadEntry]);
  if (entry) return <>{children}</>;
  if (me.team_name) return msg ? <div className="notice">{msg}</div> : <p className="muted">Getting your team ready&hellip;</p>;

  async function create(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("entries").insert({ season: season.id, team_name: name.trim(), user_id: me.user_id });
    if (error) { setMsg(error.message); return; }
    await reloadEntry();
  }

  return (
    <div className="card narrow">
      <h2>Name your team for {season.name}</h2>
      <p className="sub">One team per tournament. Your calls count in every league you&apos;re in, and you back one match a round as your Banker.</p>
      <form onSubmit={create} className="row">
        <input required maxLength={40} placeholder="Team name" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit">Create</button>
      </form>
      {msg && <p className="small" style={{ color: "var(--danger)" }}>{msg}</p>}
    </div>
  );
}
