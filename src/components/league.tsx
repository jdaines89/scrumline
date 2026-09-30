"use client";

import { readCache, writeCache } from "@/lib/cache";
import { createContext, useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { SponsorTabs } from "@/components/sponsor-tabs";
import { isBusinessSession, isPublicPath, isSchoolPath, isSchoolSession, isSponsorPath } from "@/lib/account";
import { supabase } from "@/lib/supabase";
import type { Competition, Entry, Match, Member, Pool, Season, Team } from "@/lib/types";
import { poolLabel } from "@/components/pool-name";

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

function remember(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch { return null; }
}

/** The newest season that hasn't finished yet, else the newest. */
function defaultSeason(seasons: Season[]): Season {
  return seasons.find((s) => !s.is_replay) ?? seasons[0];
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
  const [data, setData] = useState<SeasonData | null>(null);
  const [poolId, setPoolId] = useState<number | null>(null);

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
      setSeasonId(sid);
      const d = readCache<SeasonData>(`season:${sid}`);
      if (d) { setData(d); const p = Number(remember(`pool:${sid}`)); setPoolId(d.pools.some((x) => x.id === p) ? p : d.pools[0]?.id ?? null); }
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
      const [seasons, comps, teams, members] = await Promise.all([
        supabase.from("seasons").select("*").order("starts_on", { ascending: false, nullsFirst: false }),
        supabase.from("competitions").select("*"),
        supabase.from("teams").select("id, display_name, short_name, stadium, colour, colour_ink, badge_url"),
        supabase.from("members").select("*").order("display_name"),
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
      // A tapped notification links to one pool (?pool=4): open its tournament and pool.
      const linked = Number(new URLSearchParams(window.location.search).get("pool"));
      if (linked) {
        const { data: lp } = await supabase.from("pools").select("id, season").eq("id", linked).maybeSingle();
        if (lp) { remember("season", lp.season); remember(`pool:${lp.season}`, String(lp.id)); }
        window.history.replaceState(null, "", window.location.pathname);
      }
      const saved = remember("season");
      setSeasonId(ss.some((s) => s.id === saved) ? saved : defaultSeason(ss).id);
    })();
  }, []);

  const loadSeason = useCallback(async () => {
    if (!base || !seasonId) return;
    const [matches, entries, pools] = await Promise.all([
      supabase.from("matches").select("*").eq("season", seasonId).order("kickoff_at"),
      supabase.from("entries").select("*").eq("season", seasonId).eq("user_id", base.me.user_id),
      supabase.from("pools").select("*").eq("season", seasonId).order("created_at"),
    ]);
    const ps = (pools.data ?? []) as Pool[];
    const fresh: SeasonData = { matches: (matches.data ?? []) as Match[], entry: (entries.data?.[0] as Entry | undefined) ?? null, pools: ps };
    writeCache(`season:${seasonId}`, fresh);
    setData(fresh);
    const saved = Number(remember(`pool:${seasonId}`));
    setPoolId(ps.some((p) => p.id === saved) ? saved : ps[0]?.id ?? null);
  }, [base, seasonId]);
  useEffect(() => { loadSeason(); }, [loadSeason]);

  if (business) return <BusinessOnly>{children}</BusinessOnly>;
  if (schoolOnly) return <SchoolOnly>{children}</SchoolOnly>;
  if (error) return <div className="notice">{error}</div>;
  if (!base || !seasonId || !data) return <p className="muted">Loading the league&hellip;</p>;

  const season = base.seasons.find((s) => s.id === seasonId)!;
  const value: League = {
    ...base, season,
    setSeason: (id) => { remember("season", id); setData(readCache<SeasonData>(`season:${id}`) ?? null); setSeasonId(id); },
    pools: data.pools,
    pool: data.pools.find((p) => p.id === poolId) ?? null,
    setPool: (id) => { remember(`pool:${seasonId}`, String(id)); setPoolId(id); },
    reloadPools: loadSeason,
    matches: data.matches,
    rounds: [...new Set(data.matches.map((m) => m.round))].sort((a, b) => a - b),
    entry: data.entry,
    reloadEntry: loadSeason,
  };
  return (
    <Ctx.Provider value={value}>
      <Switcher />
      {children}
    </Ctx.Provider>
  );
}

// Only these screens show one pool's view; everywhere else the pool picker is noise.
const POOL_SCREENS = ["/leaderboard"];

/** Which tournament you're looking at, and on pool screens which pool. */
function Switcher() {
  const { seasons, season, setSeason, pools, pool, setPool } = useLeague();
  const path = usePathname() ?? "";
  if (isSponsorPath(path)) return <SponsorTabs />;
  // Chat picks its pool in its own header, so the conversation gets the screen.
  if (isSchoolPath(path) || path.startsWith("/admin") || path.startsWith("/chat")) return null;
  const showPool = POOL_SCREENS.some((p) => path.startsWith(p));
  return (
    <div className="switcher">
      <label>
        <span>Tournament</span>
        <select value={season.id} onChange={(e) => setSeason(e.target.value)}>
          {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_replay ? " (replay)" : ""}</option>)}
        </select>
      </label>
      {showPool && <label>
        <span>Pool</span>
        {pools.length ? (
          <select value={pool?.id ?? ""} onChange={(e) => setPool(Number(e.target.value))}>
            {pools.map((p) => <option key={p.id} value={p.id}>{poolLabel(p)}</option>)}
          </select>
        ) : <Link href="/pools/" className="nopool">Start or join a pool</Link>}
      </label>}
    </div>
  );
}

/** Screens that need a pool: points the way to one when you have none. */
export function NeedsPool({ children }: { children: ReactNode }) {
  const { pool, season } = useLeague();
  if (pool) return <>{children}</>;
  return (
    <div className="card narrow">
      <h2>No pool yet</h2>
      <p className="sub">You&apos;re not in a pool for {season.name}. Start one or join with a code from a mate.</p>
      <Link className="btn" href="/pools/">Go to pools</Link>
    </div>
  );
}

export function NeedsEntry({ children }: { children: ReactNode }) {
  const { entry, season, reloadEntry, me } = useLeague();
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  if (entry) return <>{children}</>;

  async function create(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("entries").insert({ season: season.id, team_name: name.trim(), user_id: me.user_id });
    if (error) { setMsg(error.message); return; }
    await reloadEntry();
  }

  return (
    <div className="card narrow">
      <h2>Name your team for {season.name}</h2>
      <p className="sub">One team per tournament. Your calls count in every pool you&apos;re in, and you back one match a round as your Banker.</p>
      <form onSubmit={create} className="row">
        <input required maxLength={40} placeholder="Team name" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit">Create</button>
      </form>
      {msg && <p className="small" style={{ color: "var(--danger)" }}>{msg}</p>}
    </div>
  );
}
