"use client";

import { LeaguePicture, leagueOf } from "@/components/league-picture";
import { RoundOptions } from "@/components/counts-from";
import { OrganiserLine } from "@/components/organiser-line";
import { joinLink } from "@/lib/join-link";
import Link from "next/link";
import { ListCrest, useCrests } from "@/components/crest";
import { SchoolStep } from "@/components/school-step";
import { schoolHref } from "@/lib/crest";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLeague } from "@/components/league";
import { InviteCard } from "@/components/invite-card";
import { InviteSheet, WaitingInvites } from "@/components/league-invites";
import { runsLeague } from "@/components/league-admin";
import { latestWin } from "@/components/prize-line";
import type { PoolPrize } from "@/lib/prizes";
import { monthName, type RecruiterPrize } from "@/lib/recruiter-prizes";
import { supabase } from "@/lib/supabase";
import { logEvent } from "@/lib/events";
import { PoolName, poolTitle } from "@/components/pool-name";
import { readCache, writeCache } from "@/lib/cache";
import type { Pool } from "@/lib/types";
import { roundName, roundText } from "@/lib/format";
import { ord } from "@/lib/growth";

interface Score { pool_id: number; user_id: string; total_points: number }
interface Unread { pool_id: number; unread: number; tagged: number }
/** Your class at one of your schools: its place among the ranked classes (null until 3 of it are playing). */
interface ClassPlace { emis: string; stage: string; school_year: number; place: number | null; ranked: number; players: number }
const CLASS_RANKED_AT = 3;
type Prize = Pick<PoolPrize, "round" | "prize" | "status" | "winners" | "due_at">;

/** Where you stand in one league: rank, how many, and the gap to the top. */
interface Standing { rank: number; of: number; gap: number; leader: string | null; joint: boolean; scored: boolean }

function standing(rows: Score[], me: string): Standing | null {
  const mine = rows.find((r) => r.user_id === me);
  if (!mine) return null;
  const top = Math.max(...rows.map((r) => r.total_points));
  const leaders = rows.filter((r) => r.total_points === top);
  return {
    rank: 1 + rows.filter((r) => r.total_points > mine.total_points).length,
    of: rows.length, gap: top - mine.total_points,
    leader: leaders.length === 1 ? leaders[0].user_id : null,
    joint: leaders.length > 1,
    scored: top > 0,
  };
}

export default function PoolsPage() {
  const { season, pools, pool, setPool, reloadPools, members, me, rounds } = useLeague();
  const crests = useCrests();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  // Where a new league's points start: "" for every round.
  const [from, setFrom] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [myCode, setMyCode] = useState<string | null>(null);
  const [business, setBusiness] = useState(false);
  const names = new Map(members.map((m) => [m.user_id, m.display_name]));
  const router = useRouter();
  const [open, setOpen] = useState<"start" | "join" | null>(null);
  // The league you just started, until you've sent it to your group.
  const [made, setMade] = useState<{ id: number; name: string; code: string } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  // The league whose invite sheet is open.
  const [inviting, setInviting] = useState<Pool | null>(null);
  // The school question again, for anyone who skipped it at sign-up.
  const [addingSchool, setAddingSchool] = useState(false);
  // Asked of the schools you've saved, not of the leagues on screen, so it never shows to someone who has one.
  const [noSchool, setNoSchool] = useState(false);
  useEffect(() => {
    let live = true;
    supabase.from("member_schools").select("stage").eq("user_id", me.user_id)
      .then(({ data, error }) => { if (live) setNoSchool(!error && (data ?? []).length === 0); });
    return () => { live = false; };
  }, [me.user_id, addingSchool]);
  const ids = pools.map((p) => p.id).join(",");
  const [scores, setScores] = useState<Score[]>(() => readCache<Score[]>(`leagues:${ids}`) ?? []);
  // Each card's extras draw from last visit's copy straight away, so nothing arrives late and pushes the cards down.
  const [unread, setUnread] = useState<Unread[]>(() => readCache<Unread[]>(`leagues-unread:${ids}`) ?? []);
  const [prizes, setPrizes] = useState<Map<number, Prize>>(() => new Map(readCache<[number, Prize][]>(`leagues-prizes:${ids}`) ?? []));
  const [recruiter, setRecruiter] = useState<Map<number, RecruiterPrize>>(() => new Map(readCache<[number, RecruiterPrize][]>(`leagues-recruiter:${ids}`) ?? []));
  const [toConfirm, setToConfirm] = useState<Map<string, number>>(() => new Map(readCache<[string, number][]>(`leagues-confirm:${ids}`) ?? []));
  const [classPlaces, setClassPlaces] = useState<ClassPlace[]>(() => readCache<ClassPlace[]>(`leagues-classes:${season.id}`) ?? []);
  const classPlace = (p: Pool) => p.school_year ? classPlaces.find((c) => c.emis === p.school_emis && c.stage === p.school_stage) : undefined;

  // Where your class stands at each of your schools, for its row.
  useEffect(() => {
    setClassPlaces(readCache<ClassPlace[]>(`leagues-classes:${season.id}`) ?? []);
    if (!pools.some((p) => p.school_year)) return;
    supabase.rpc("my_class_places", { p_season: season.id })
      .then(({ data, error }) => { if (error) return; const r = (data ?? []) as ClassPlace[]; writeCache(`leagues-classes:${season.id}`, r); setClassPlaces(r); });
  }, [season.id, ids]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every league's table in one go, for your rank on each card.
  useEffect(() => {
    if (!pools.length) { setScores([]); return; }
    setScores(readCache<Score[]>(`leagues:${ids}`) ?? []);
    setUnread(readCache<Unread[]>(`leagues-unread:${ids}`) ?? []);
    setPrizes(new Map(readCache<[number, Prize][]>(`leagues-prizes:${ids}`) ?? []));
    setRecruiter(new Map(readCache<[number, RecruiterPrize][]>(`leagues-recruiter:${ids}`) ?? []));
    setToConfirm(new Map(readCache<[string, number][]>(`leagues-confirm:${ids}`) ?? []));
    supabase.from("pool_leaderboard").select("pool_id, user_id, total_points").in("pool_id", pools.map((p) => p.id))
      .then(({ data }) => { const r = (data ?? []) as Score[]; writeCache(`leagues:${ids}`, r); setScores(r); });
    supabase.from("chat_unread").select("pool_id, unread, tagged").in("pool_id", pools.map((p) => leagueOf(p)))
      .then(({ data }) => { const r = (data ?? []) as Unread[]; writeCache(`leagues-unread:${ids}`, r); setUnread(r); });
    // This round's prize, for mates' leagues (school leagues don't take round prizes).
    Promise.all(pools.filter((p) => !p.school_emis).map((p) =>
      supabase.rpc("pool_prizes", { p_pool: p.id }).then(({ data }) => {
        const list = (data ?? []) as Prize[];
        const now = list.find((x) => x.status === "in play") ?? list.find((x) => x.status === "upcoming") ?? latestWin(list);
        return [p.id, now] as const;
      }))).then((pairs) => {
        const got = pairs.filter((x): x is readonly [number, Prize] => !!x[1]);
        writeCache(`leagues-prizes:${ids}`, got); setPrizes(new Map(got));
      });
    // This month's recruiter prize, shown by the Invite button, since inviting is how it's won.
    Promise.all(pools.map((p) =>
      supabase.rpc("pool_recruiter_prizes", { p_pool: p.id }).then(({ data }) => {
        const list = (data ?? []) as RecruiterPrize[];
        return [p.id, list.find((x) => x.status === "open")] as const;
      }))).then((pairs) => {
        const got = pairs.filter((x): x is readonly [number, RecruiterPrize] => !!x[1]);
        writeCache(`leagues-recruiter:${ids}`, got); setRecruiter(new Map(got));
      });
    // Schoolmates at your schools you haven't confirmed yet.
    const schools = pools.filter((p) => p.school_emis && !p.school_year);
    if (schools.length) {
      Promise.all([
        supabase.from("school_members").select("user_id, stage, emis").in("emis", schools.map((p) => p.school_emis!)),
        supabase.from("school_vouches").select("member_id, stage").eq("voucher_id", me.user_id),
      ]).then(([sm, mv]) => {
        const done = new Set(((mv.data ?? []) as { member_id: string; stage: string }[]).map((v) => `${v.member_id}:${v.stage}`));
        const counts = new Map<string, number>();
        for (const r of (sm.data ?? []) as { user_id: string; stage: string; emis: string }[]) {
          if (r.user_id === me.user_id || done.has(`${r.user_id}:${r.stage}`)) continue;
          counts.set(`${r.emis}:${r.stage}`, (counts.get(`${r.emis}:${r.stage}`) ?? 0) + 1);
        }
        writeCache(`leagues-confirm:${ids}`, [...counts]); setToConfirm(counts);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  const byPool = useMemo(() => {
    const m = new Map<number, Score[]>();
    for (const s of scores) m.set(s.pool_id, [...(m.get(s.pool_id) ?? []), s]);
    return m;
  }, [scores]);
  const mateLeagues = pools.filter((p) => !p.school_emis);
  const schoolLeagues = pools.filter((p) => p.school_emis && !p.school_year);
  const classOf = (p: Pool) => pools.find((c) => c.school_year && c.school_emis === p.school_emis && c.school_stage === p.school_stage);
  // A class with no whole-school league above it still gets a card of its own.
  const looseClasses = pools.filter((c) => c.school_year && !schoolLeagues.some((p) => p.school_emis === c.school_emis && p.school_stage === c.school_stage));
  // The same recruiter prize often runs in several of your leagues: show it once, on the first card it reaches.
  const recruiterShownOn = new Set<number>();
  {
    const seen = new Set<string>();
    const order = [...mateLeagues, ...schoolLeagues.flatMap((p) => [p, classOf(p)]), ...looseClasses].filter((p): p is Pool => !!p);
    for (const p of order) {
      const rp = recruiter.get(p.id);
      if (!rp) continue;
      const key = `${rp.month}|${rp.sponsor}|${rp.prize}`;
      if (seen.has(key)) continue;
      seen.add(key); recruiterShownOn.add(p.id);
    }
  }

  function openLeague(id: number) {
    setPool(id);
    router.push("/leaderboard/");
  }

  /** The muted line under a league's name: where you stand, then anything happening in it. */
  function line(p: Pool): string {
    const st = standing(byPool.get(p.id) ?? [], me.user_id);
    const bits: string[] = [];
    if (!st) bits.push(p.school_emis ? "Your school's league" : `Code ${p.join_code}`);
    else if (!st.scored) bits.push(`${st.of} player${st.of === 1 ? "" : "s"}, nobody has scored yet`);
    else if (st.gap === 0) bits.push(st.joint ? "Joint top" : "Top of the table");
    else bits.push(`${st.gap} pt${st.gap === 1 ? "" : "s"} behind ${st.leader ? names.get(st.leader) ?? "the leader" : "the top"}`);
    const cp = classPlace(p);
    if (cp?.place && cp.ranked >= 2) bits.push(`Your class is ${ord(cp.place)} of ${cp.ranked} at the school`);
    if (p.counts_from_round) bits.push(`From ${roundName(p.counts_from_round)}`);
    const pz = prizes.get(p.id);
    if (pz?.winners?.length) bits.push(`${pz.winners.map((u) => (u === me.user_id ? "You" : names.get(u) ?? "A player")).join(" & ")} won ${roundText(pz.round)}'s prize`);
    else if (pz) bits.push(`${roundName(pz.round)} prize`);
    return bits.join(" · ");
  }

  /** One league row; `label` replaces the name when it sits in its school's group. */
  function card(p: Pool, label?: string) {
    const st = standing(byPool.get(p.id) ?? [], me.user_id);
    const u = unread.find((x) => x.pool_id === leagueOf(p));
    const waiting = p.school_emis && !p.school_year ? toConfirm.get(`${p.school_emis}:${p.school_stage}`) ?? 0 : 0;
    const rp = recruiterShownOn.has(p.id) ? recruiter.get(p.id) : undefined;
    // A class not ranked yet: how many more of the year it needs, and the way to bring them in.
    const cp = classPlace(p);
    const need = cp && cp.place === null ? Math.max(1, CLASS_RANKED_AT - cp.players) : 0;
    return (
      <div key={p.id} className={`lgc${p.id === pool?.id ? " on" : ""}`}>
        <button type="button" className="lgc-main" onClick={() => openLeague(p.id)}>
          <span className="lgc-rank">{st ? <>{st.rank}<small>of {st.of}</small></> : <small>—</small>}</span>
          <span className="lgc-text">
            <strong>{label ?? <><LeaguePicture pool={p} size={24} /> <PoolName pool={p} /></>}</strong>
            <span className="lgc-line">{line(p)}</span>
          </span>
          {u && u.unread > 0 && <span className={u.tagged > 0 ? "lgc-dot at" : "lgc-dot"} aria-label={`${u.unread} unread`}>{u.tagged > 0 ? "@" : u.unread}</span>}
          <span className="lgc-chev" aria-hidden="true">›</span>
        </button>
        {!p.school_emis && (
          <button type="button" className="lgc-invite" onClick={() => setInviting(p)}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M19 8v6M16 11h6" />
            </svg>
            {copied === p.id ? "Link copied" : "Invite players"}
          </button>
        )}
        {!p.school_emis && p.created_by === me.user_id && (
          <OrganiserLine poolId={p.id} poolName={p.name} me={me.user_id} site={`${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}`} />
        )}
        {rp && (
          <button type="button" className="lgc-recruit" onClick={() => share(p.id, p.join_code, poolTitle(p), !!p.school_emis)}>
            <span className="lgc-recruit-label">{monthName(rp.month)} recruiter prize</span>
            <strong>{rp.prize}</strong> · bring in the most new players to win ›
          </button>
        )}
        {need > 0 && (
          <div className="lgc-classneed">
            <span className="small muted">
              Your class needs {need} more {need === 1 ? "player" : "players"} from {p.school_year} to be ranked against the other years.
            </span>
            <button type="button" className="lgc-invite" onClick={() => share(p.id, p.join_code, poolTitle(p), true)}>
              {copied === p.id ? "Invite ready to send" : "Invite your class"}
            </button>
          </div>
        )}
        {waiting > 0 && (
          <Link href="/me/" className="lgc-waiting">{waiting} schoolmate{waiting === 1 ? "" : "s"} waiting for you to confirm them ›</Link>
        )}
      </div>
    );
  }

  useEffect(() => {
    supabase.rpc("my_invite").then(({ data }) => setMyCode(((data ?? []) as { code: string }[])[0]?.code ?? null));
    supabase.rpc("my_businesses").then(({ data }) => setBusiness(((data ?? []) as unknown[]).length > 0));
  }, []);

  // The form stays put with a working button until the league exists, then the "ready" card replaces it at once.
  async function create(e: FormEvent) {
    e.preventDefault(); setMsg(null); setBusy(true);
    const { data, error } = await supabase.from("pools").insert({ season: season.id, name: name.trim(), created_by: me.user_id, ...(from ? { counts_from_round: Number(from) } : {}) }).select().single();
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    setOpen(null); setName(""); setFrom("");
    setMade({ id: data.id, name: data.name, code: data.join_code }); setLinkCopied(false);
    await reloadPools(); setPool(data.id);
  }

  async function join(e: FormEvent) {
    e.preventDefault(); setMsg(null); setBusy(true);
    const { data, error } = await supabase.rpc("join_pool", { p_code: code });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    setCode(""); setOpen(null); await reloadPools(); setPool(data as number);
  }

  function invite(joinCode: string, poolName: string, school = false) {
    const site = `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}`;
    // A school league isn't joined by code: newcomers land in it once they name the school.
    const link = school ? joinLink(site, myCode) : joinLink(site, myCode, joinCode);
    const text = school
      ? `Play for ${poolName} on Scrumline in the ${season.name}. Call the score of every match, climb the table and win prizes from local businesses, while helping fund South African schools. Free to play, no betting.\n\nTap to join: ${link}`
      : `Join my league "${poolName}" on Scrumline for the ${season.name}. Call the score of every match, climb the table and win prizes from local businesses, while helping fund South African schools. Free to play, no betting.\n\nTap to join: ${link}`;
    return { link, text };
  }

  async function share(id: number, joinCode: string, poolName: string, school = false) {
    const { text } = invite(joinCode, poolName, school);
    logEvent("invite_shared", { from: school ? "school" : "league" }, id);
    try {
      if (navigator.share) await navigator.share({ text });
      else await navigator.clipboard.writeText(text);
      setCopied(id);
    } catch { /* dismissed */ }
  }

  return (
    <>
      <div className="card">
        <h2>Your leagues</h2>
        <p className="sub">Your calls count in every league you&apos;re in.</p>
        <WaitingInvites onJoined={async (id) => { await reloadPools(); setPool(id); }} />
        {pools.length === 0 && <p className="muted">None yet. Start one below, or join with a code someone sent you.</p>}
        {mateLeagues.length > 0 && <>
          <div className="lg-sect">Your leagues</div>
          <div className="lg">{mateLeagues.map((p) => card(p))}</div>
        </>}
        {(schoolLeagues.length > 0 || looseClasses.length > 0) && <>
          <div className="lg-sect">Schools</div>
          <div className="lg">
            {schoolLeagues.map((p) => {
              const c = classOf(p);
              // Each school in one panel under its crest and full name, with your class in it as an equal row.
              return (
                <div key={p.id} className="lg-panel">
                  <div className="lg-panel-head">
                    <ListCrest emis={p.school_emis!} crests={crests} size={26} />
                    <span className="lg-panel-name"><PoolName pool={p} /></span>
                    <Link className="lg-panel-link" href={schoolHref(p.school_emis!)}>School page ›</Link>
                  </div>
                  {card(p, "Whole school")}
                  {c && card(c, `Class of ${c.school_year}`)}
                </div>
              );
            })}
            {looseClasses.map((p) => card(p))}
          </div>
        </>}
        {noSchool && schoolLeagues.length === 0 && looseClasses.length === 0 && <>
          <div className="lg-sect">Schools</div>
          <div className="lg-panel lg-school-empty">
            <p>Add the school you went to and you&apos;ll join its league and your class&apos;s league, playing for your school against old schoolmates.</p>
            <button type="button" onClick={() => setAddingSchool(true)}>Add your school</button>
          </div>
        </>}
        <div className="lg-actions">
          <button type="button" className={open === "start" ? "" : "ghost"} onClick={() => { setMsg(null); setOpen(open === "start" ? null : "start"); }}>Start a league</button>
          <button type="button" className={open === "join" ? "" : "ghost"} onClick={() => { setMsg(null); setOpen(open === "join" ? null : "join"); }}>Join with a code</button>
        </div>
        {made && (
          <div className="lg-made" role="status">
            <strong>{made.name} is ready</strong>
            <p className="small muted">Send it to your group. Anyone who taps the link lands straight in your league.</p>
            <div className="row">
              <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(invite(made.code, made.name).text)}`} target="_blank" rel="noreferrer"
                onClick={() => logEvent("invite_shared", { from: "new_league", via: "whatsapp" }, made.id)}>Send on WhatsApp</a>
              <button type="button" className="ghost" onClick={async () => {
                logEvent("invite_shared", { from: "new_league", via: "copy" }, made.id);
                try { await navigator.clipboard.writeText(invite(made.code, made.name).link); setLinkCopied(true); } catch { /* no clipboard */ }
              }}>{linkCopied ? "Link copied" : "Copy link"}</button>
              <button type="button" className="ghost" onClick={() => setMade(null)}>Done</button>
            </div>
            <p className="small muted" style={{ margin: "8px 0 0" }}>Or tell them the code: <strong className="lg-code">{made.code}</strong></p>
          </div>
        )}
        {open === "start" && (
          <form className="lg-form" onSubmit={create}>
            <p className="small muted">Your league plays every tournament on Scrumline, with one chat for the group. Next you send it to your group on WhatsApp.</p>
            <div className="row">
              <input required autoFocus maxLength={40} placeholder="League name" value={name} onChange={(e) => setName(e.target.value)} />
              <button type="submit" disabled={busy}>{busy ? "Starting…" : "Start"}</button>
            </div>
            {rounds.length > 1 && (
              <label className="lg-from">
                <span className="small muted">Points count from</span>
                <select value={from} onChange={(e) => setFrom(e.target.value)}><RoundOptions rounds={rounds} /></select>
              </label>
            )}
          </form>
        )}
        {open === "join" && (
          <form className="lg-form" onSubmit={join}>
            <p className="small muted">Type the six-character code you were sent.</p>
            <div className="row">
              <input required autoFocus maxLength={6} placeholder="e.g. 7K2Q9D" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
                style={{ textTransform: "uppercase", letterSpacing: ".12em" }} />
              <button type="submit" disabled={busy}>{busy ? "Joining…" : "Join"}</button>
            </div>
          </form>
        )}
        {msg && <div className="notice" style={{ marginTop: 12 }}>{msg}</div>}
        {business && <p className="small muted" style={{ margin: "14px 0 0" }}>Putting up a prize from your business? That&apos;s in <Link href="/sponsor/prizes/">Business, Prizes</Link>.</p>}
      </div>
      <InviteCard />
      {addingSchool && (
        <SchoolStep me={me} onJoined={reloadPools} onDone={() => setAddingSchool(false)} onLater={() => setAddingSchool(false)} />
      )}
      {inviting && (
        <InviteSheet poolId={inviting.id} poolName={inviting.name} joinCode={inviting.join_code} onClose={() => setInviting(null)}
          runs={runsLeague(inviting, me)} onCodeChanged={(c) => { setInviting({ ...inviting, join_code: c }); reloadPools(); }}
          onSendLink={() => { const p = inviting; setInviting(null); share(p.id, p.join_code, p.name); }} />
      )}
    </>
  );
}
