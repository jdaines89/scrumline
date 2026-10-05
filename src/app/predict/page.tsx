"use client";

import Link from "next/link";
import { AlertsCard } from "@/components/alerts-card";
import { AllSet, type NextStep } from "@/components/all-set";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { NeedsEntry, useLeague } from "@/components/league";
import { RoundPicker } from "@/components/round-picker";
import { Crowd, type CrowdRow } from "@/components/crowd";
import { RoundDigest } from "@/components/round-digest";
import { PrizeLine } from "@/components/prize-line";
import { usePoolPrizes } from "@/lib/prizes";
import { TournamentLine } from "@/components/tournament-line";
import { useSeasonSponsors } from "@/lib/tournament-sponsor";
import { Form } from "@/components/form";
import { buildDigest } from "@/lib/digest";
import { Crest } from "@/components/team";
import { kickoff } from "@/lib/format";
import { isRugbyScore, scoreInput } from "@/lib/rugby";
import { firstOpenRound, lockRound, useRoundLocks } from "@/lib/rounds";
import { readCache, writeCache } from "@/lib/cache";
import { supabase } from "@/lib/supabase";
import type { LeaderRow, Prediction } from "@/lib/types";

interface PredScore {
  match_id: string; total_pts: number; is_banker: boolean;
  result_pts: number; margin_pts: number; near_pts: number; exact_pts: number;
}

// What each chip on a scored match means. Mirrors public.compute_points() (stored in prediction_points).
const PARTS = [
  { key: "result_pts", code: "RES", max: "6", what: "Right result: you picked the winner, or the draw" },
  { key: "margin_pts", code: "MAR", max: "5", what: "Exact winning margin" },
  { key: "near_pts",   code: "CLS", max: "2 per team", what: "Close: a team's score within 3 points" },
  { key: "exact_pts",  code: "EXA", max: "5", what: "Exact score" },
] as const;

const bad = (v: string) => v !== "" && !isRugbyScore(Number(v));

interface MateCall extends Prediction { name: string; pts: number | null }

// Everything one round of Predict shows, as kept on the device between visits.
interface RoundBundle { preds: Prediction[]; scores: PredScore[]; mates: MateCall[]; locks: string[]; crowd: CrowdRow[] }

function Breakdown({ s }: { s: PredScore }) {
  return (
    <div className="breakdown">
      {PARTS.map((p) => {
        const v = s[p.key];
        return <span key={p.code} className={v > 0 ? "pchip on" : "pchip"} title={p.what}>{p.code}{v > 0 ? ` +${v}` : ""}</span>;
      })}
      {s.is_banker && <span className="pchip bank2" title="Banker: this match counts double">×2</span>}
    </div>
  );
}

export default function PredictPage() {
  return <NeedsEntry><Predict /></NeedsEntry>;
}

function Predict() {
  const { entry, season, matches, rounds, teams, me, members, pools, pool, reloadPools } = useLeague();
  // Just arrived from a league invite (/join sends ?welcome=1): say where they are and what to do.
  const [welcome, setWelcome] = useState(false);
  useEffect(() => { setWelcome(new URLSearchParams(window.location.search).get("welcome") === "1"); }, []);
  const [code, setCode] = useState("");
  const [remind, setRemind] = useState(me.email_reminders);
  const { locked, isLocked, matchStarted, reload: reloadLocks } = useRoundLocks(entry!.id, season, matches);
  const [round, setRound] = useState<number | null>(null);
  const [prizes, reloadPrizes] = usePoolPrizes(pool?.id);
  const backers = useSeasonSponsors(season.id);
  const [preds, setPreds] = useState<Map<string, Prediction>>(new Map());
  const [draft, setDraft] = useState<Record<string, [string, string]>>({});
  const [scores, setScores] = useState<Map<string, PredScore>>(new Map());
  const [mates, setMates] = useState<MateCall[]>([]);
  const [myLocks, setMyLocks] = useState<Set<string>>(new Set());
  const [crowd, setCrowd] = useState<Map<string, CrowdRow>>(new Map());
  const [msg, setMsg] = useState<string | null>(null);
  // The pool's table, for the digest's "where you stand" line.
  const [table, setTable] = useState<LeaderRow[]>([]);
  // Which round's data is on screen (cached or fresh); until then the cards show placeholders.
  const [ready, setReady] = useState<string | null>(null);
  // Boxes typed into since the round opened, so a fresh copy landing late never overwrites them.
  const touched = useRef<Set<string>>(new Set());
  const shown = useRef<string | null>(null);

  useEffect(() => { if (round === null && rounds.length) setRound(firstOpenRound(rounds, isLocked)); }, [round, rounds, isLocked]);

  const ms = matches.filter((m) => m.round === round);
  const apply = useCallback((b: RoundBundle) => {
    setCrowd(new Map(b.crowd.map((x) => [x.match_id, x])));
    setMyLocks(new Set(b.locks));
    setMates(b.mates);
    const map = new Map(b.preds.map((x) => [x.match_id, x]));
    setPreds(map);
    setDraft((d) => {
      const next: Record<string, [string, string]> = Object.fromEntries([...map].map(([k, v]) => [k, [String(v.home_score), String(v.away_score)]]));
      for (const k of touched.current) if (d[k]) next[k] = d[k];
      return next;
    });
    setScores(new Map(b.scores.map((x) => [x.match_id, x])));
  }, []);

  const load = useCallback(async () => {
    if (round === null) return;
    const key = `predict:${entry!.id}:${round}`;
    const cached = readCache<RoundBundle>(key);
    // Only on first opening a round: a reload after a save must not flash back to the old copy.
    if (cached && shown.current !== key) { apply(cached); setReady(key); }
    shown.current = key;
    const ids = matches.filter((m) => m.round === round).map((m) => m.id);
    const [p, s, theirs, theirScores, entries, ml, cr] = await Promise.all([
      supabase.from("predictions").select("*").eq("entry_id", entry!.id).in("match_id", ids),
      supabase.from("prediction_scores").select("match_id, total_pts, is_banker, result_pts, margin_pts, near_pts, exact_pts").eq("entry_id", entry!.id).in("match_id", ids),
      // Only calls that are locked come back: the database hides the rest.
      supabase.from("predictions").select("entry_id, match_id, home_score, away_score, is_banker").neq("entry_id", entry!.id).in("match_id", ids),
      supabase.from("prediction_scores").select("entry_id, match_id, total_pts").neq("entry_id", entry!.id).in("match_id", ids),
      supabase.from("entries").select("id, user_id, team_name").eq("season", season.id),
      supabase.from("match_locks").select("match_id").eq("entry_id", entry!.id).in("match_id", ids),
      // Every player's calls as totals, only for matches your own call can no longer change.
      supabase.rpc("match_crowd", { p_season: season.id }),
    ]);
    const owner = new Map(((entries.data ?? []) as { id: number; user_id: string }[]).map((e) => [e.id, e.user_id]));
    const pts = new Map(((theirScores.data ?? []) as { entry_id: number; match_id: string; total_pts: number }[])
      .map((x) => [`${x.entry_id}:${x.match_id}`, x.total_pts]));
    const fresh: RoundBundle = {
      crowd: (cr.data ?? []) as CrowdRow[],
      locks: (ml.data ?? []).map((r: { match_id: string }) => r.match_id),
      mates: ((theirs.data ?? []) as Prediction[]).map((x) => ({
        ...x, name: members.find((m) => m.user_id === owner.get(x.entry_id))?.display_name ?? "A mate",
        pts: pts.get(`${x.entry_id}:${x.match_id}`) ?? null,
      })).sort((a, b) => a.name.localeCompare(b.name)),
      preds: (p.data ?? []) as Prediction[],
      scores: (s.data ?? []) as PredScore[],
    };
    writeCache(key, fresh);
    apply(fresh);
    setReady(key);
  }, [entry, round, matches, season.id, members, apply]);
  useEffect(() => { touched.current = new Set(); }, [round]);
  useEffect(() => {
    if (!pool) { setTable([]); return; }
    const key = `pooltable:${pool.id}`;
    setTable(readCache<LeaderRow[]>(key) ?? []);
    supabase.from("pool_leaderboard").select("*").eq("pool_id", pool.id)
      .then(({ data }) => { if (data) { writeCache(key, data); setTable(data as LeaderRow[]); } });
  }, [pool]);
  useEffect(() => { load(); }, [load]);

  if (round === null) return null;
  const done = isLocked(round);
  const total = [...scores.values()].reduce((a, b) => a + b.total_pts, 0);
  const filled = ms.filter((m) => preds.has(m.id)).length;
  // Each side's last five results this season before the round starts, newest last. Blank until they've played.
  const firstKick = ms.map((m) => m.kickoff_at).sort()[0];
  const form = new Map<string, string>();
  for (const x of matches.filter((m) => m.home_score !== null && m.away_score !== null && m.kickoff_at < firstKick)
    .sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at))) {
    const r = x.home_score! > x.away_score! ? ["W", "L"] : x.home_score! < x.away_score! ? ["L", "W"] : ["D", "D"];
    form.set(x.home_team_id, ((form.get(x.home_team_id) ?? "") + r[0]).slice(-5));
    form.set(x.away_team_id, ((form.get(x.away_team_id) ?? "") + r[1]).slice(-5));
  }
  const hasBanker = ms.some((m) => preds.get(m.id)?.is_banker);
  // Mates in the pool you're looking at; with no pool, anyone whose calls you can see.
  const inPool = new Set(table.map((r) => r.entry_id));
  const digest = ready === `predict:${entry!.id}:${round}` ? buildDigest({
    myEntry: entry!.id,
    mine: [...preds.values()],
    mates: pool && table.length ? mates.filter((x) => inPool.has(x.entry_id)) : mates,
    matches: ms.map((m) => ({ id: m.id, home: teams.get(m.home_team_id)?.display_name ?? "Home",
      away: teams.get(m.away_team_id)?.display_name ?? "Away", finished: m.home_score !== null })),
    table, poolName: pool?.name ?? null,
  }) : null;
  const unlockedCalls = season.is_replay ? 0 : ms.filter((m) => preds.has(m.id) && !matchStarted(m) && !myLocks.has(m.id)).length;

  // Every call in: say when it starts and offer the few things worth doing meanwhile.
  const allIn = !done && !season.is_replay && ms.length > 0 && filled === ms.length && ready === `predict:${entry!.id}:${round}`;
  const steps: NextStep[] = [];
  if (allIn) {
    const openIds = ms.filter((m) => !matchStarted(m) && !myLocks.has(m.id)).map((m) => m.id);
    if (openIds.length) steps.push({
      title: `Lock ${openIds.length === ms.length ? "your" : openIds.length} call${openIds.length === 1 ? "" : "s"} to see your mates'`,
      detail: "You'll see what everyone who's locked the same games called. A lock can't be undone.",
      onClick: () => { if (window.confirm(`Lock ${openIds.length} call${openIds.length === 1 ? "" : "s"}? You can't change them after.`)) lockMatches(openIds); },
    });
    const talk = pool ?? pools[0] ?? null;
    if (talk) {
      const bm = ms.find((m) => preds.get(m.id)?.is_banker);
      const bp = bm && preds.get(bm.id)!;
      const line = bm && bp
        ? `My Banker for round ${round}: ${teams.get(bm.home_team_id)?.display_name} ${bp.home_score}–${bp.away_score} ${teams.get(bm.away_team_id)?.display_name}. Who's going against it?`
        : `My calls are in for round ${round}. Who's going against me?`;
      steps.push({
        title: bm ? `Tell ${talk.name} your Banker` : `Tell ${talk.name} you're in`,
        detail: bm && bp ? `${teams.get(bm.home_team_id)?.display_name} ${bp.home_score}–${bp.away_score} ${teams.get(bm.away_team_id)?.display_name}, counting double` : "A message is ready to send in the pool chat",
        href: `/chat/?pool=${talk.id}&say=${encodeURIComponent(line)}`,
      });
    }
    const after = rounds[rounds.indexOf(round) + 1];
    const nextMs = matches.filter((m) => m.round === after);
    if (after !== undefined && nextMs.length && !nextMs.some((m) => matchStarted(m))) {
      steps.push({
        title: `Get round ${after} in early`,
        detail: `${nextMs.length} games, first on ${kickoff(nextMs.map((m) => m.kickoff_at).sort()[0])}`,
        onClick: () => { setRound(after); window.scrollTo({ top: 0, behavior: "smooth" }); },
      });
    }
  }

  async function save(matchId: string, rawH: string, rawA: string) {
    const h = scoreInput(rawH), a = scoreInput(rawA);
    touched.current.add(matchId);
    setDraft((d) => ({ ...d, [matchId]: [h, a] }));
    if (h === "" || a === "" || !isRugbyScore(+h) || !isRugbyScore(+a)) return;
    setMsg(null);
    const { error } = await supabase.from("predictions").upsert(
      { entry_id: entry!.id, match_id: matchId, home_score: Number(h), away_score: Number(a) });
    if (error) setMsg(error.message);
    else setPreds((p) => new Map(p).set(matchId, { entry_id: entry!.id, match_id: matchId, home_score: +h, away_score: +a, is_banker: p.get(matchId)?.is_banker ?? false }));
  }

  async function back(matchId: string) {
    setMsg(null);
    const { error } = await supabase.from("predictions").update({ is_banker: true })
      .eq("entry_id", entry!.id).eq("match_id", matchId);
    if (error) setMsg(error.message); else await load();
  }

  async function toggleReminders(on: boolean) {
    setRemind(on);
    const { error } = await supabase.from("members").update({ email_reminders: on }).eq("user_id", me.user_id);
    if (error) { setRemind(!on); setMsg(error.message); }
  }

  // Live seasons: lock a call before kickoff to see mates who've locked theirs.
  async function lockMatches(matchIds: string[]) {
    if (!matchIds.length) return;
    setMsg(null);
    const { error } = await supabase.from("match_locks").insert(matchIds.map((id) => ({ entry_id: entry!.id, match_id: id })));
    if (error) setMsg(error.message);
    await load();
  }

  async function clearRound() {
    const ids = ms.filter((m) => preds.has(m.id) && !(done || matchStarted(m) || myLocks.has(m.id))).map((m) => m.id);
    if (!ids.length || !window.confirm(`Clear your ${ids.length} unlocked call${ids.length === 1 ? "" : "s"} for round ${round}?`)) return;
    setMsg(null);
    const { error } = await supabase.from("predictions").delete().eq("entry_id", entry!.id).in("match_id", ids);
    if (error) setMsg(error.message);
    await load();
  }

  async function lockIn() {
    const { error } = await lockRound(entry!.id, season.id, round!);
    if (error) setMsg(error.message);
    await reloadLocks(); await load();
  }


  async function joinPool(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    const { error } = await supabase.rpc("join_pool", { p_code: code.trim() });
    if (error) setMsg(error.message); else { setCode(""); await reloadPools(); }
  }

  return (
    <>
      {pools.length === 0 && (
        <form className="notice joinnudge" onSubmit={joinPool}>
          <span>You&apos;re not in a pool for {season.name} yet, so nobody sees your score on a leaderboard. Got a code from a mate?</span>
          <span className="row">
            <input required maxLength={6} placeholder="Pool code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <button type="submit">Join</button>
          </span>
        </form>
      )}
      {welcome && pool && (
        <div className="card welcome-card">
          <strong>You&apos;re in {pool.name}</strong>
          <span className="small muted">Call the score of each game below. One Banker a round doubles your points. Your calls count in every league you join.</span>
          <button type="button" className="ghost" onClick={() => setWelcome(false)}>Got it</button>
        </div>
      )}
      {!welcome && <AlertsCard />}
      <RoundPicker rounds={rounds} round={round} onPick={setRound} locked={locked} matches={matches} />
      <div className="card">
        <h2>Round {round} {done && <span className="badge win">locked</span>}</h2>
        <p className="sub">
          {done ? <>You scored <strong>{total}</strong> this round.</>
            : <>{filled} of {ms.length} called{hasBanker ? ", Banker picked" : ", no Banker yet"}.</>}
        </p>
        <TournamentLine sponsors={backers} seasonName={season.name} round={round} title={false} />
        {round !== null && prizes.some((p) => p.round === round) && <PrizeLine prizes={prizes.filter((p) => p.round === round)} round={round} onChange={reloadPrizes} compact />}
        {digest && <RoundDigest d={digest} round={round} open={unlockedCalls} teamsOf={(id) => {
          const m = ms.find((x) => x.id === id)!;
          return [teams.get(m.home_team_id)!, teams.get(m.away_team_id)!];
        }} />}
        {!done && (
          <details className="rules">
            <summary>How scoring works</summary>
            6 for the right result, 5 more for the exact margin, 2 for each side within 3 points, and 5 more for the exact score. Back one match as your <strong>Banker</strong> and it counts double. <Link href="/rules/">Full rules</Link>.
          </details>
        )}
        {ready !== `predict:${entry!.id}:${round}` ? ms.map((m) => <div key={m.id} className="match skeleton" style={{ height: 150 }} />) : ms.map((m) => {
          const h = teams.get(m.home_team_id)!, a = teams.get(m.away_team_id)!;
          const d = draft[m.id] ?? ["", ""];
          const p = preds.get(m.id);
          const started = matchStarted(m);
          const shut = done || started || myLocks.has(m.id);
          const bankerShut = ms.some((x) => preds.get(x.id)?.is_banker && (matchStarted(x) || myLocks.has(x.id)));
          return (
            <div key={m.id} className={p?.is_banker ? "match banker" : "match"}>
              <div className="mhead">
                <span>{kickoff(m.kickoff_at)} · {m.venue}</span>
                <span className="mactions">
                  {p?.is_banker ? <span className="bank on">Banker ×2</span>
                    : !shut && !bankerShut && p ? <button type="button" className="bank" onClick={() => back(m.id)}>Make Banker</button> : null}
                  {!season.is_replay && !started && (myLocks.has(m.id)
                    ? <span className="bank locked">🔒 Locked</span>
                    : p && <button type="button" className="bank" onClick={() => lockMatches([m.id])}>Lock</button>)}
                </span>
              </div>
              <div className="pred">
                <span className="pteam"><span className="ha home">Home</span><Crest team={h} size={30} /></span>
                <input className={`pbox${bad(d[0]) ? " bad" : ""}`} inputMode="numeric" pattern="[0-9]*" maxLength={2} disabled={shut} value={d[0]}
                  aria-label={`${h.display_name} score`} onChange={(e) => save(m.id, e.target.value, d[1])} />
                <span className="muted">–</span>
                <input className={`pbox${bad(d[1]) ? " bad" : ""}`} inputMode="numeric" pattern="[0-9]*" maxLength={2} disabled={shut} value={d[1]}
                  aria-label={`${a.display_name} score`} onChange={(e) => save(m.id, d[0], e.target.value)} />
                <span className="pteam away"><span className="ha">Away</span><Crest team={a} size={30} /></span>
              </div>
              <div className="pnames">
                <span><strong>{h.display_name}</strong><Form f={form.get(h.id)} /></span>
                <span className="away"><strong>{a.display_name}</strong><Form f={form.get(a.id)} align="right" /></span>
              </div>
              {!shut && (bad(d[0]) || bad(d[1])) && (
                <p className="scorewarn">A rugby side can&apos;t score 1, 2 or 4, so this call isn&apos;t saved yet.</p>
              )}
              {shut && m.home_score !== null && (done || !season.is_replay) && (
                <div className="presult">
                  <div>
                    <span>Real score <strong>{m.home_score}–{m.away_score}</strong></span>
                    {scores.has(m.id) && <Breakdown s={scores.get(m.id)!} />}
                  </div>
                  <span className="pts">{scores.has(m.id) ? `+${scores.get(m.id)!.total_pts}` : "no call"}</span>
                </div>
              )}
              {crowd.has(m.id) && <Crowd c={crowd.get(m.id)!} home={h} away={a} />}
              {mates.some((x) => x.match_id === m.id) && (
                <details className="mates">
                  <summary>Your mates&apos; calls ({mates.filter((x) => x.match_id === m.id).length})</summary>
                  <ul>
                    {mates.filter((x) => x.match_id === m.id).map((x) => (
                      <li key={x.entry_id}>
                        <span>{x.name}{x.is_banker && <span className="pchip bank2">×2</span>}</span>
                        <strong>{x.home_score}–{x.away_score}</strong>
                        <span className="pts">{x.pts !== null ? `+${x.pts}` : ""}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          );
        })}
        {allIn && <AllSet round={round} firstKick={firstKick} steps={steps} />}
        {scores.size > 0 && (
          <dl className="legend">
            {PARTS.map((p) => <div key={p.code}><dt><span className="pchip on">{p.code}</span></dt><dd>{p.what}, +{p.max}</dd></div>)}
            <div><dt><span className="pchip bank2">×2</span></dt><dd>Your Banker, so that match counts double</dd></div>
          </dl>
        )}
        {msg && <p className="small" style={{ color: "var(--danger)" }}>{msg}</p>}
        {!season.is_replay && (
          <label className="small muted toggle">
            <input type="checkbox" checked={remind} onChange={(e) => toggleReminders(e.target.checked)} />
            Remind me an hour before kickoff if I haven&apos;t called a score
          </label>
        )}
        {!done && (
          <div className="roundactions">
            {!season.is_replay && (() => {
              const open = ms.filter((m) => preds.has(m.id) && !matchStarted(m) && !myLocks.has(m.id)).map((m) => m.id);
              return open.length > 0 && !allIn && (
                <button type="button" onClick={() => {
                  if (window.confirm(`Lock ${open.length} call${open.length === 1 ? "" : "s"}? You can't change them after, but you'll see the calls of mates who've locked the same games.`)) lockMatches(open);
                }}>Lock {open.length === ms.length ? "all" : open.length} call{open.length === 1 ? "" : "s"}</button>
              );
            })()}
            {ms.some((m) => preds.has(m.id) && !matchStarted(m) && !myLocks.has(m.id)) && (
              <button type="button" className="ghost" onClick={clearRound}>Clear unlocked calls</button>
            )}
          </div>
        )}
        {!season.is_replay && !done && (
          <p className="small muted">Every call locks at kickoff anyway. Lock one earlier and you&apos;ll see the calls of mates who&apos;ve locked that game too. A lock can&apos;t be undone.</p>
        )}
        {!done && season.is_replay && (
          <>
            <p className="small muted">Locking in a round can't be undone. Then you see how it scored.</p>
            <button type="button" disabled={filled < ms.length || !hasBanker} onClick={lockIn}>
              {filled < ms.length ? `Call ${ms.length - filled} more` : !hasBanker ? "Pick your Banker" : `Lock in round ${round}`}
            </button>
          </>
        )}
      </div>
    </>
  );
}
