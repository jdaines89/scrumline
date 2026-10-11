"use client";

import { useEffect, useState } from "react";
import { NeedsEntry, useLeague } from "@/components/league";
import { achievements, type Achievement, type ScoredCall } from "@/lib/achievements";
import { readCache, writeCache } from "@/lib/cache";
import { supabase } from "@/lib/supabase";

function Row({ a }: { a: Achievement }) {
  return (
    <li className={`ach${a.earned ? " earned" : ""}`}>
      <div className="ach-head">
        <strong>{a.title}</strong>
        {a.earned && <span className="ach-stamp">Earned</span>}
      </div>
      <p className="small muted">{a.rule}</p>
      <div className="gate-bar" aria-hidden="true"><span style={{ width: `${(a.have / a.goal) * 100}%` }} /></div>
      <p className="small ach-note">{a.note}</p>
      <p className="small muted ach-reward">Reward: none set yet. We will say here when a sponsor backs this one.</p>
    </li>
  );
}

function Achievements() {
  const { entry, matches, season } = useLeague();
  const [calls, setCalls] = useState<ScoredCall[] | null>(null);
  useEffect(() => {
    if (!entry) return;
    const key = `ach:${entry.id}`;
    setCalls(readCache<ScoredCall[]>(key) ?? null);
    supabase.from("prediction_points").select("round, right_result, near_pts, exact_pts, is_banker").eq("entry_id", entry.id)
      .then(({ data }) => { const rows = (data ?? []) as ScoredCall[]; writeCache(key, rows); setCalls(rows); });
  }, [entry]);

  const list = achievements(calls ?? [], matches);
  const done = list.filter((a) => a.earned).length;
  return (
    <div className="card narrow">
      <p className="sp-kicker">Achievements</p>
      <h2>What to aim for</h2>
      <p className="sub">{calls === null ? " " : `${done} of ${list.length} earned in ${season.name}. For the glory: nothing here changes your points or place.`}</p>
      <ul className="ach-list">{list.map((a) => <Row key={a.key} a={a} />)}</ul>
    </div>
  );
}

export default function AchievementsPage() {
  return <NeedsEntry><Achievements /></NeedsEntry>;
}
