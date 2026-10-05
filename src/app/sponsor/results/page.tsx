"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { initials, money, query } from "@/lib/sponsor";
import { SAMPLE_ALLOC, SAMPLE_BOOKING, SAMPLE_MINE, SAMPLE_RESULTS, previewOn, sampleDays } from "@/lib/preview";
import { supabase } from "@/lib/supabase";
import { roundText } from "@/lib/format";

interface Mine { booking_id: number; sponsor_name: string; pool_name: string; season_name: string; round: number | null; status: string; price_minor: number; currency: string; creative_status: string | null }
interface Results { players: number; reached: number; seen: number; shares: number; taps: number }
interface Alloc { school: string; share: string; amount_minor: number; currency: string; status: string }
interface Day { day: string; seen: number }

const STATE: Record<string, string> = {
  held: "Waiting for payment. The slot is held for 30 minutes.",
  paid: "Paid, thank you. Your line needs a quick check before it goes live.",
  live: "Live: players see your name now.",
  ended: "This sponsorship has ended.",
  refund_due: "Someone else paid for this slot a moment before you. Your money is being refunded in full.",
  refunded: "Refunded in full.",
};
const STATUS: Record<string, string> = {
  held: "Waiting for payment", paid: "Paid · line being checked", live: "Live", ended: "Ended",
  refund_due: "Being refunded", refunded: "Refunded",
};
const PAID = { due: "on its way", paid: "paid", confirmed: "received" } as Record<string, string>;

/** Weeks ending today, oldest first: views per week. */
function weekly(days: Day[]): number[] {
  const now = Date.now();
  const out = [0, 0, 0, 0, 0, 0];
  for (const d of days) {
    const w = Math.floor((now - new Date(d.day).getTime()) / (7 * 864e5));
    if (w >= 0 && w < 6) out[5 - w] += d.seen;
  }
  return out;
}

export default function SponsorResults() {
  const [b, setB] = useState<Mine | null | undefined>(undefined);
  const [list, setList] = useState<Mine[] | null>(null);
  const [r, setR] = useState<Results | null>(null);
  const [alloc, setAlloc] = useState<Alloc[]>([]);
  const [days, setDays] = useState<Day[]>([]);

  useEffect(() => {
    (async () => {
      let id = Number(query("b"));
      let mine: Mine[] | null = null;
      if (!id) {
        // The sponsor's home: every sponsorship, or straight into the only one.
        const { data } = await supabase.rpc("my_sponsorships");
        mine = [...(previewOn() ? [SAMPLE_MINE] : []), ...((data ?? []) as Mine[])];
        if (mine.length !== 1) { setList(mine); setB(null); return; }
        id = mine[0].booking_id;
      }
      if (id === SAMPLE_BOOKING) { setB(SAMPLE_MINE); setR(SAMPLE_RESULTS); setAlloc(SAMPLE_ALLOC); setDays(sampleDays()); return; }
      const [m, res, al, dd] = await Promise.all([
        mine ? Promise.resolve({ data: mine }) : supabase.rpc("my_sponsorships"),
        supabase.rpc("sponsor_results", { p_booking: id }),
        supabase.rpc("sponsor_allocations", { p_booking: id }),
        supabase.from("sponsor_daily").select("day, seen").eq("booking_id", id),
      ]);
      setB(((m.data ?? []) as Mine[]).find((x) => x.booking_id === id) ?? null);
      setR(((res.data ?? []) as Results[])[0] ?? null);
      setAlloc((al.data ?? []) as Alloc[]);
      setDays((dd.data ?? []) as Day[]);
    })();
  }, []);

  if (list) return (
    <div className="card narrow">
      <h2>Your results</h2>
      {list.length === 0 ? (
        <>
          <p className="sub">Once you back a school, this is where you see how often players saw your name, what they shared, and every rand that reached the schools.</p>
          <Link className="btn" href="/sponsor/">Sponsor a school</Link>
        </>
      ) : (
        <>
          <p className="sub">Tap a sponsorship to see how often players saw your name and what reached the schools.</p>
          {list.map((m) => (
            <Link key={m.booking_id} className="rowline" href={`/sponsor/results/?b=${m.booking_id}`}>
              <span>{m.pool_name}{m.round ? `, ${roundText(m.round)}` : ""}<span className="small muted"> · {m.season_name}</span></span>
              <span className="small muted">{STATUS[m.status] ?? m.status}</span>
            </Link>
          ))}
        </>
      )}
    </div>
  );
  if (b === undefined) return <div className="skeleton" style={{ height: 240 }} />;
  if (!b) return <div className="card narrow"><h2>Sponsorship not found</h2><Link className="btn" href="/sponsor/results/">Your sponsorships</Link></div>;

  const bars = weekly(days);
  const top = Math.max(1, ...bars);
  const n = (x: number) => String(x).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return (
    <>
      <div className="card narrow">
        <div className="sp-head">
          <div className="sp-tile big">{initials(b.sponsor_name)}</div>
          <div><h2>{b.sponsor_name}</h2>
            <div className="small muted">{b.pool_name}{b.round ? `, ${roundText(b.round)}` : ""} · {b.season_name}</div></div>
        </div>
        <p className={`small ${b.status === "live" ? "school-ok" : "muted"}`}>{STATE[b.status] ?? b.status}</p>
        {r && (
          <>
            <div className="kpis">
              <div className="kpi"><b>{n(r.players)}</b><span>players in the pool</span></div>
              <div className="kpi"><b>{n(r.seen)}</b><span>times your name was seen</span></div>
              <div className="kpi"><b>{n(r.shares)}</b><span>recap cards shared</span></div>
              <div className="kpi"><b>{n(r.taps)}</b><span>taps through to your site</span></div>
            </div>
            {r.seen > 0 && <>
              <p className="small muted">Seen each week</p>
              <div className="bars">{bars.map((v, i) => <i key={i} className={i === 5 ? "last" : ""} style={{ height: `${Math.max(4, (v / top) * 100)}%` }} />)}</div>
            </>}
          </>
        )}
      </div>
      {alloc.length > 0 && (
        <div className="card narrow">
          <h2>Money to schools</h2>
          {alloc.map((a, i) => (
            <div key={i} className="rowline">
              <span>{a.school}</span>
              <span><b>{money(a.amount_minor, a.currency)}</b> <span className="small muted">· {PAID[a.status] ?? a.status}</span></span>
            </div>
          ))}
          <p className="small muted">Schools are paid monthly and confirm receipt. Your section 18A certificate is emailed once they have.</p>
        </div>
      )}
      <p className="small muted" style={{ textAlign: "center" }}><Link href="/sponsor/results/">All your sponsorships</Link></p>
    </>
  );
}
