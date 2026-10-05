"use client";

import { OrganiserLine } from "@/components/organiser-line";
import { joinLink } from "@/lib/join-link";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLeague } from "@/components/league";
import { InviteCard } from "@/components/invite-card";
import { latestWin } from "@/components/prize-line";
import type { PoolPrize } from "@/lib/prizes";
import { monthName, type RecruiterPrize } from "@/lib/recruiter-prizes";
import { supabase } from "@/lib/supabase";
import { logEvent } from "@/lib/events";
import { PoolName, poolTitle } from "@/components/pool-name";
import { readCache, writeCache } from "@/lib/cache";
import type { Pool } from "@/lib/types";
import { roundName, roundText } from "@/lib/format";

interface Score { pool_id: number; user_id: string; total_points: number }
interface Unread { pool_id: number; unread: number; tagged: number }
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
  const { season, pools, pool, setPool, reloadPools, members, me } = useLeague();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
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
  const ids = pools.map((p) => p.id).join(",");
  const [scores, setScores] = useState<Score[]>(() => readCache<Score[]>(`leagues:${ids}`) ?? []);
  const [unread, setUnread] = useState<Unread[]>([]);
  const [prizes, setPrizes] = useState<Map<number, Prize>>(new Map());
  const [recruiter, setRecruiter] = useState<Map<number, RecruiterPrize>>(new Map());
  const [toConfirm, setToConfirm] = useState<Map<string, number>>(new Map());

  // Every league's table in one go, for your rank on each card.
  useEffect(() => {
    if (!pools.length) { setScores([]); return; }
    setScores(readCache<Score[]>(`leagues:${ids}`) ?? []);
    supabase.from("pool_leaderboard").select("pool_id, user_id, total_points").in("pool_id", pools.map((p) => p.id))
      .then(({ data }) => { const r = (data ?? []) as Score[]; writeCache(`leagues:${ids}`, r); setScores(r); });
    supabase.from("chat_unread").select("pool_id, unread, tagged").in("pool_id", pools.map((p) => p.id))
      .then(({ data }) => setUnread((data ?? []) as Unread[]));
    // This round's prize, for mates' leagues (school leagues don't take round prizes).
    Promise.all(pools.filter((p) => !p.school_emis).map((p) =>
      supabase.rpc("pool_prizes", { p_pool: p.id }).then(({ data }) => {
        const list = (data ?? []) as Prize[];
        const now = list.find((x) => x.status === "in play") ?? list.find((x) => x.status === "upcoming") ?? latestWin(list);
        return [p.id, now] as const;
      }))).then((pairs) => setPrizes(new Map(pairs.filter((x): x is readonly [number, Prize] => !!x[1]))));
    // This month's recruiter prize, shown by the Invite button, since inviting is how it's won.
    Promise.all(pools.map((p) =>
      supabase.rpc("pool_recruiter_prizes", { p_pool: p.id }).then(({ data }) => {
        const list = (data ?? []) as RecruiterPrize[];
        return [p.id, list.find((x) => x.status === "open")] as const;
      }))).then((pairs) => setRecruiter(new Map(pairs.filter((x): x is readonly [number, RecruiterPrize] => !!x[1]))));
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
        setToConfirm(counts);
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
    const pz = prizes.get(p.id);
    if (pz?.winners?.length) bits.push(`${pz.winners.map((u) => (u === me.user_id ? "You" : names.get(u) ?? "A mate")).join(" & ")} won ${roundText(pz.round)}'s prize`);
    else if (pz) bits.push(`${roundName(pz.round)} prize`);
    return bits.join(" · ");
  }

  /** One league row; `label` replaces the name when it sits in its school's group. */
  function card(p: Pool, label?: string) {
    const st = standing(byPool.get(p.id) ?? [], me.user_id);
    const u = unread.find((x) => x.pool_id === p.id);
    const waiting = p.school_emis && !p.school_year ? toConfirm.get(`${p.school_emis}:${p.school_stage}`) ?? 0 : 0;
    const rp = recruiter.get(p.id);
    return (
      <div key={p.id} className={`lgc${p.id === pool?.id ? " on" : ""}`}>
        <button type="button" className="lgc-main" onClick={() => openLeague(p.id)}>
          <span className="lgc-rank">{st ? <>{st.rank}<small>of {st.of}</small></> : <small>—</small>}</span>
          <span className="lgc-text">
            <strong>{label ?? <PoolName pool={p} />}</strong>
            <span className="lgc-line">{line(p)}</span>
          </span>
          {u && u.unread > 0 && <span className={u.tagged > 0 ? "lgc-dot at" : "lgc-dot"} aria-label={`${u.unread} unread`}>{u.tagged > 0 ? "@" : u.unread}</span>}
          <span className="lgc-chev" aria-hidden="true">›</span>
        </button>
        {!p.school_emis && (
          <button type="button" className="ghost lgc-invite" onClick={() => share(p.id, p.join_code, p.name)}>{copied === p.id ? "Copied" : "Invite"}</button>
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

  async function create(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    setOpen(null);
    const { data, error } = await supabase.from("pools").insert({ season: season.id, name: name.trim(), created_by: me.user_id }).select().single();
    if (error) { setMsg(error.message); return; }
    setName(""); await reloadPools(); setPool(data.id);
    setMade({ id: data.id, name: data.name, code: data.join_code }); setLinkCopied(false);
  }

  async function join(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    const { data, error } = await supabase.rpc("join_pool", { p_code: code });
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
        {pools.length === 0 && <p className="muted">None yet. Start one below, or join with a code from a mate.</p>}
        {mateLeagues.length > 0 && <>
          <div className="lg-sect">Mates</div>
          <div className="lg">{mateLeagues.map((p) => card(p))}</div>
        </>}
        {(schoolLeagues.length > 0 || looseClasses.length > 0) && <>
          <div className="lg-sect">Schools</div>
          <div className="lg">
            {schoolLeagues.map((p) => {
              const c = classOf(p);
              if (!c) return card(p);
              // A school and your class in it: one panel under the school's name, two equal rows.
              return (
                <div key={p.id} className="lg-panel">
                  <div className="lg-panel-head"><PoolName pool={p} /></div>
                  {card(p, "Whole school")}
                  {card(c, `Class of ${c.school_year}`)}
                </div>
              );
            })}
            {looseClasses.map((p) => card(p))}
          </div>
        </>}
        <div className="lg-actions">
          <button type="button" className={open === "start" ? "" : "ghost"} onClick={() => { setMsg(null); setOpen(open === "start" ? null : "start"); }}>Start a league</button>
          <button type="button" className={open === "join" ? "" : "ghost"} onClick={() => { setMsg(null); setOpen(open === "join" ? null : "join"); }}>Join with a code</button>
        </div>
        {made && (
          <div className="lg-made">
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
            <p className="small muted">Next you send it to your group on WhatsApp.</p>
            <div className="row">
              <input required autoFocus maxLength={40} placeholder="League name" value={name} onChange={(e) => setName(e.target.value)} />
              <button type="submit">Start</button>
            </div>
          </form>
        )}
        {open === "join" && (
          <form className="lg-form" onSubmit={join}>
            <p className="small muted">Type the six-character code you were sent.</p>
            <div className="row">
              <input required autoFocus maxLength={6} placeholder="e.g. 7K2Q9D" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
                style={{ textTransform: "uppercase", letterSpacing: ".12em" }} />
              <button type="submit">Join</button>
            </div>
          </form>
        )}
        {msg && <div className="notice" style={{ marginTop: 12 }}>{msg}</div>}
        {business && <p className="small muted" style={{ margin: "14px 0 0" }}>Putting up a prize from your business? That&apos;s in <Link href="/sponsor/prizes/">Business, Prizes</Link>.</p>}
      </div>
      <InviteCard />
    </>
  );
}
