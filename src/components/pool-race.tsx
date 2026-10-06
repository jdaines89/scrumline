"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLeague } from "@/components/league";
import { readCache, writeCache } from "@/lib/cache";
import { supabase } from "@/lib/supabase";
import type { LeaderRow } from "@/lib/types";
import { roundShort, roundText } from "@/lib/format";
import { countsFrom } from "@/lib/rounds";

interface Scored { entry_id: number; round: number; total_pts: number }
interface Line { user_id: string; name: string; mine: boolean; pts: number[] }

const FEW = 6;
const H = 200, PAD = { l: 30, r: 96, t: 10, b: 24 };

/** Running totals round by round: your line in colour, everyone else's quiet behind it. */
export function PoolRace({ rows }: { rows: LeaderRow[] }) {
  const { pool, season, matches, me } = useLeague();
  const [scored, setScored] = useState<Scored[]>(() => readCache<Scored[]>(`race:${pool!.id}`) ?? []);
  const [at, setAt] = useState<number | null>(null);
  // Drawn at the box's real width, so text stays the same size on a phone and a laptop.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(340);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [rows.length, matches.length]);
  const entries = rows.filter((r) => r.entry_id !== null);
  const ids = entries.map((r) => r.entry_id!).join(",");
  // A league that counts from a later round starts its race there.
  const from = countsFrom(pool);
  const rounds = useMemo(() => [...new Set(matches.filter((m) => m.home_score !== null && m.round >= from).map((m) => m.round))].sort((a, b) => a - b), [matches, from]);

  useEffect(() => {
    if (!ids) return;
    supabase.from("prediction_scores").select("entry_id, round, total_pts")
      .eq("season", season.id).in("entry_id", ids.split(",").map(Number))
      .then(({ data }) => { const r = (data ?? []) as Scored[]; writeCache(`race:${pool!.id}`, r); setScored(r); });
  }, [ids, season.id, pool]);

  if (entries.length < 2 || rounds.length === 0) return null;

  // Start at 0, then the running total after each round played.
  const lines: Line[] = entries.map((r) => {
    let run = 0;
    const pts = [0, ...rounds.map((rd) => (run += scored.filter((s) => s.entry_id === r.entry_id && s.round === rd).reduce((a, s) => a + s.total_pts, 0)))];
    return { user_id: r.user_id, name: r.manager, mine: r.user_id === me.user_id, pts };
  });
  const top = niceMax(Math.max(10, ...lines.flatMap((l) => l.pts)));
  const n = rounds.length;
  const x = (i: number) => PAD.l + (i / n) * (W - PAD.l - PAD.r);
  const y = (v: number) => H - PAD.b - (v / top) * (H - PAD.t - PAD.b);
  const ticks = [0, top / 2, top];
  // Yours drawn last so it sits on top.
  const ordered = [...lines].sort((a, b) => Number(a.mine) - Number(b.mine));
  // A small pool labels everyone. A big one labels only the leader and the
  // people either side of you, so the ends never pile up.
  const many = lines.length > FEW;
  const standing = [...lines].sort((a, b) => b.pts[n] - a.pts[n] || a.name.localeCompare(b.name));
  const myAt = standing.findIndex((l) => l.mine);
  const named = many ? new Set([standing[0], standing[myAt - 1], standing[myAt], standing[myAt + 1]].filter(Boolean).map((l) => l!.user_id)) : null;
  const labels = spread(lines.filter((l) => !named || named.has(l.user_id)).map((l) => ({ l, y: y(l.pts[n]) })), 15, PAD.t, H - PAD.b);
  const rankOf = (l: Line) => 1 + lines.filter((o) => o.pts[n] > l.pts[n]).length;
  const col = at ?? null;
  const atAll = col === null ? [] : [...lines].sort((a, b) => b.pts[col] - a.pts[col] || a.name.localeCompare(b.name));
  // The tooltip: everyone in a small pool; the top 3 and you in a big one.
  const atMine = atAll.findIndex((l) => l.mine);
  const atRows = !many ? atAll.map((l, i) => ({ l, rank: i + 1 }))
    : [...atAll.slice(0, 3).map((l, i) => ({ l, rank: i + 1 })), ...(atMine >= 3 ? [{ l: atAll[atMine], rank: atMine + 1 }] : [])];

  return (
    <figure className="race">
      <figcaption className="small muted">
        Points race, round by round{many && myAt >= 0 ? ` · you're ${ordinal(rankOf(standing[myAt]))} of ${lines.length}` : ""}
      </figcaption>
      <div className="racebox" ref={box}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Running points for ${lines.length} players over ${n} round${n === 1 ? "" : "s"}`}
          onMouseLeave={() => setAt(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="grid" />
              <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className="tick">{Math.round(t)}</text>
            </g>
          ))}
          {[0, ...rounds].map((rd, i) => (
            <text key={i} x={x(i)} y={H - 6} textAnchor="middle" className="tick">{i === 0 ? "Start" : roundShort(rd)}</text>
          ))}
          {col !== null && <line x1={x(col)} x2={x(col)} y1={PAD.t} y2={H - PAD.b} className="cross" />}
          {ordered.map((l) => (
            <g key={l.user_id} className={`rl${l.mine ? " mine" : ""}${many ? " many" : ""}`}>
              <polyline points={l.pts.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
              <circle cx={x(n)} cy={y(l.pts[n])} r={l.mine ? 4 : 3} />
            </g>
          ))}
          {labels.map(({ l, y: ly }) => (
            <text key={l.user_id} x={x(n) + 10} y={ly + 4} className={l.mine ? "rlabel mine" : "rlabel"}>
              {many && !l.mine ? `${rankOf(l)}. ` : ""}{l.mine ? "You" : l.name} {l.pts[n]}
            </text>
          ))}
          {/* Wide invisible columns: hover or tap a round to see where everyone stood. */}
          {[0, ...rounds].map((_, i) => (
            <rect key={i} x={x(i) - (W - PAD.l - PAD.r) / n / 2} y={0} width={(W - PAD.l - PAD.r) / n} height={H}
              fill="transparent" onMouseEnter={() => setAt(i)} onClick={() => setAt(at === i ? null : i)} />
          ))}
        </svg>
        {col !== null && (
          <div className="racetip" style={{ left: `${Math.min(80, Math.max(20, (x(col) / W) * 100))}%` }}>
            <strong>{col === 0 ? "Start" : `After ${roundText(rounds[col - 1])}`}</strong>
            {atRows.map(({ l, rank }) => (
              <div key={l.user_id} className={l.mine ? "mine" : ""}>
                <span>{many ? `${rank}. ` : ""}{l.mine ? "You" : l.name}</span><span>{l.pts[col]}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </figure>
  );
}

function ordinal(k: number): string {
  const t = k % 100 >= 11 && k % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][k % 10] ?? "th";
  return `${k}${t}`;
}

/** A round top for the y axis: 10, 20, 50, 100, 150… */
function niceMax(v: number): number {
  const step = v <= 20 ? 10 : v <= 100 ? 20 : 50;
  return Math.ceil(v / step) * step;
}

/** Nudges end labels apart so names never sit on top of each other. */
function spread<T extends { y: number }>(items: T[], gap: number, lo: number, hi: number): T[] {
  const out = [...items].sort((a, b) => a.y - b.y).map((it) => ({ ...it }));
  for (let i = 1; i < out.length; i++) if (out[i].y - out[i - 1].y < gap) out[i].y = out[i - 1].y + gap;
  const over = out.length ? out[out.length - 1].y - hi : 0;
  if (over > 0) for (const it of out) it.y -= over;
  for (let i = 0; i < out.length; i++) if (out[i].y < lo) out[i].y = lo + i * gap;
  return out;
}
