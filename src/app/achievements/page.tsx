"use client";

import { useEffect, useState } from "react";
import { AchBadge } from "@/components/achievement-badge";
import { NeedsEntry, useLeague } from "@/components/league";
import { achievements, type Achievement, type ScoredCall } from "@/lib/achievements";
import { readCache, writeCache } from "@/lib/cache";
import { rewardTag, type MyReward } from "@/lib/rewards";
import { supabase } from "@/lib/supabase";
import { SponsorAbout, SponsorTile, TrialTag } from "@/components/sponsor-tile";
import { trialRewards, usePreview } from "@/lib/preview";

// Earned badges this phone has already shown off, so each pops only the first time.
const SEEN_KEY = "sl:ach-seen";
const seen = (): string[] => { try { return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as string[]; } catch { return []; } };

function Achievements() {
  const { entry, matches, season } = useLeague();
  const [realRewards, setRewards] = useState<MyReward[]>([]);
  const trial = usePreview();
  const [trialClaimed, setTrialClaimed] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [biz, setBiz] = useState(false);
  const loadRewards = () => { supabase.rpc("my_rewards", { p_season: season.id }).then(({ data }) => setRewards((data ?? []) as MyReward[])); };
  useEffect(loadRewards, [season.id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function claim(r: MyReward) {
    setMsg(null);
    if (r.campaign_id < 0) { setTrialClaimed((c) => [...c, r.achievement_key]); return; }  // trial: nothing is written
    const { error } = await supabase.rpc("claim_reward", { p_campaign: r.campaign_id });
    if (error) setMsg(error.message);
    loadRewards();
  }
  const [calls, setCalls] = useState<ScoredCall[] | null>(null);
  const [open, setOpen] = useState<Achievement | null>(null);
  const [fresh, setFresh] = useState<string[]>([]);
  useEffect(() => {
    if (!entry) return;
    const key = `ach:${entry.id}`;
    setCalls(readCache<ScoredCall[]>(key) ?? null);
    supabase.from("prediction_points").select("round, right_result, near_pts, exact_pts, is_banker").eq("entry_id", entry.id)
      .then(({ data }) => { const rows = (data ?? []) as ScoredCall[]; writeCache(key, rows); setCalls(rows); });
  }, [entry]);

  const list = achievements(calls ?? [], matches);
  // Trial rewards fill in only while the tournament has no real ones.
  const rewards = trial && !realRewards.length
    ? trialRewards((k) => !!list.find((a) => a.key === k)?.earned, trialClaimed) : realRewards;
  const rewardFor = (key: string) => rewards.find((r) => r.achievement_key === key);
  useEffect(() => {
    if (calls === null) return;
    const done = list.filter((a) => a.earned).map((a) => a.key);
    const old = seen();
    setFresh(done.filter((k) => !old.includes(k)));
    try { localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...old, ...done])])); } catch { /* private mode: it just plays again */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calls]);

  return (
    <div className="card narrow">
      <p className="sp-kicker">Achievements</p>
      <h2>{calls ? `${list.filter((a) => a.earned).length} of ${list.length} unlocked` : " "}</h2>
      <div className="achgrid">
        {list.map((a) => (
          <button key={a.key} type="button" className="achtile" onClick={() => { setOpen(a); setBiz(false); }} aria-label={`${a.title}: ${a.earned ? "unlocked" : a.note}`}>
            <AchBadge k={a.key} have={a.have} goal={a.goal} earned={a.earned} play={fresh.includes(a.key)} />
            <strong>{a.title}</strong>
            <span className="small muted">{a.earned ? "Unlocked" : a.goal > 1 ? `${a.have} of ${a.goal}` : "Locked"}</span>
            {rewardTag(rewardFor(a.key)) && <span className="small ach-tag">{rewardTag(rewardFor(a.key))}</span>}
          </button>
        ))}
      </div>
      {open && (
        <div className="wip-dim" onClick={() => setOpen(null)}>
          <div className="wip-sheet achsheet" role="dialog" aria-modal="true" aria-label={open.title} onClick={(e) => e.stopPropagation()}>
            <AchBadge k={open.key} have={open.have} goal={open.goal} earned={open.earned} size={120} />
            <h2>{open.title}</h2>
            <p>{open.rule}</p>
            <p className="small muted">{open.note}</p>
            {(() => {
              const r = rewardFor(open.key);
              if (!r) return null;
              return (
                <div className="ach-reward">
                  <strong>{r.title}</strong>
                  {r.sponsor_name && (
                    <button type="button" className="ach-biz" aria-expanded={biz} onClick={() => setBiz(!biz)}>
                      <SponsorTile name={r.sponsor_name} logo={r.sponsor_logo ?? null} />
                      <span><small>From</small><b>{r.sponsor_name}{r.campaign_id < 0 && <TrialTag />}</b></span>
                      {(r.sponsor_about || r.sponsor_website) && <span className="ach-biz-go" aria-hidden="true">›</span>}
                    </button>
                  )}
                  {biz && <SponsorAbout about={r.sponsor_about ?? null} website={r.sponsor_website ?? null} />}
                  {r.claimed && r.code ? (
                    <>
                      <code className="ach-code">{r.code}</code>
                      <button type="button" className="ghost" onClick={() => { navigator.clipboard?.writeText(r.code ?? "").then(() => setCopied(true), () => {}); }}>{copied ? "Copied" : "Copy code"}</button>
                    </>
                  ) : r.earned && r.remaining > 0 ? (
                    <button type="button" className="btn" onClick={() => claim(r)}>Claim reward</button>
                  ) : r.earned ? <span className="small muted">All of these have been claimed.</span>
                    : <span className="small muted">Unlock this badge to claim it. {r.remaining} left.</span>}
                  {r.terms && <span className="small muted">{r.terms}</span>}
                  {msg && <span className="small" style={{ color: "var(--danger)" }}>{msg}</span>}
                </div>
              );
            })()}
            <button type="button" className="ghost" onClick={() => setOpen(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AchievementsPage() {
  return <NeedsEntry><Achievements /></NeedsEntry>;
}
