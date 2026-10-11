"use client";

import { useEffect, useState } from "react";
import { AchBadge } from "@/components/achievement-badge";
import { NeedsEntry, useLeague } from "@/components/league";
import { achievements, type Achievement, type ScoredCall } from "@/lib/achievements";
import { readCache, writeCache } from "@/lib/cache";
import { supabase } from "@/lib/supabase";

// Earned badges this phone has already shown off, so each pops only the first time.
const SEEN_KEY = "sl:ach-seen";
const seen = (): string[] => { try { return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as string[]; } catch { return []; } };

function Achievements() {
  const { entry, matches } = useLeague();
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
          <button key={a.key} type="button" className="achtile" onClick={() => setOpen(a)} aria-label={`${a.title}: ${a.earned ? "unlocked" : a.note}`}>
            <AchBadge k={a.key} have={a.have} goal={a.goal} earned={a.earned} play={fresh.includes(a.key)} />
            <strong>{a.title}</strong>
            <span className="small muted">{a.earned ? "Unlocked" : a.goal > 1 ? `${a.have} of ${a.goal}` : "Locked"}</span>
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
