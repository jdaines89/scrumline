"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { money, split } from "@/lib/sponsor";
import { useSponsorSeason } from "@/lib/sponsor-season";
import { supabase } from "@/lib/supabase";
import type { School } from "@/lib/types";

interface Slot {
  pool_id: number; pool_name: string; kind: "school" | "class" | "pool"; school_year: number | null; players: number;
  price_minor: number | null; currency: string; available: boolean; taken_by: string | null; reason: string | null;
  next_round: number | null; round_price_minor: number | null; round_available: boolean | null;
}
interface Mine { booking_id: number; sponsor_name: string; pool_name: string; season_name: string; round: number | null; status: string; price_minor: number; currency: string }
interface Partner { emis: string; name: string; town: string | null; distance_km: number | null }
interface Pick { slot: Slot; round: number | null; price: number }

const STATUS: Record<string, string> = {
  held: "Waiting for payment", paid: "Paid · line being checked", live: "Live", ended: "Ended",
  refund_due: "Being refunded", refunded: "Refunded",
};

export default function SponsorPage() {
  const { seasons, season, setSeason, loading } = useSponsorSeason();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<School[]>([]);
  const [school, setSchool] = useState<School | null>(null);
  const [partner, setPartner] = useState<Partner | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [mine, setMine] = useState<Mine[]>([]);

  useEffect(() => { supabase.rpc("my_sponsorships").then(({ data }) => setMine((data ?? []) as Mine[])); }, []);

  useEffect(() => {
    const text = q.trim();
    if (school || text.replace(/\s/g, "").length < 3) { setHits([]); return; }
    let live = true;
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("search_schools", { p_query: text, p_stage: "high" });
      if (live) setHits((data ?? []) as School[]);
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q, school]);

  useEffect(() => {
    setSlots(null); setPick(null); setPartner(null);
    if (!school || !season) return;
    supabase.rpc("sponsor_slots", { p_emis: school.emis, p_season: season.id }).then(({ data }) => {
      const ss = (data ?? []) as Slot[];
      setSlots(ss);
      const first = ss.find((s) => s.available && s.price_minor);
      if (first) setPick({ slot: first, round: null, price: first.price_minor! });
    });
    supabase.rpc("school_partner", { p_emis: school.emis })
      .then(({ data }) => setPartner(((data ?? []) as Partner[])[0] ?? null));
  }, [school, season?.id]);

  const label = (s: Slot) => s.kind === "school" ? "The whole school" : s.school_year ? `Class of ${s.school_year}` : s.pool_name;
  const what = (s: Slot) => s.kind === "school"
    ? "the school's pool, its table and every recap its players share"
    : "their pool, chat header and round prizes";
  const roundSlot = pick?.slot.next_round ? pick.slot : slots?.find((s) => s.next_round && s.round_available);
  const sp = pick ? split(pick.price) : null;
  const cur = pick?.slot.currency ?? "ZAR";

  if (loading) return <div className="skeleton" style={{ height: 200 }} />;
  if (!season) return <div className="card narrow"><h2>No tournament is open yet</h2><p className="sub">Check back when the next season is loaded.</p></div>;

  return (
    <>
      <div className="card narrow">
        <p className="sp-kicker">For businesses</p>
        <h2>Back a school on Scrumline</h2>
        <p className="sub">Put your business in front of a school&apos;s former pupils for a whole {season.name} season. 40% of what you pay goes straight to schools.</p>
        {seasons.length > 1 && (
          <label className="sp-season">
            <span className="small muted">Tournament</span>
            <select value={season.id} onChange={(e) => setSeason(e.target.value)}>
              {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}

        {school ? (
          <div className="school-saved">
            <div>
              <div className="school-name">{school.name}</div>
              <div className="small muted">{school.town}</div>
            </div>
            <button type="button" className="ghost" onClick={() => { setSchool(null); setQ(""); }}>Other school</button>
          </div>
        ) : (
          <>
            <input className="wide" placeholder="Find a school by name or nickname" value={q} onChange={(e) => setQ(e.target.value)} />
            {hits.length > 0 && (
              <ul className="school-hits">
                {hits.map((s) => (
                  <li key={s.emis}>
                    <button type="button" onClick={() => setSchool(s)}>
                      <span>{s.name}</span><span className="small muted">{s.town}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {school && slots === null && <div className="skeleton" style={{ height: 80, marginTop: 10 }} />}
        {school && slots?.length === 0 && (
          <p className="small muted">Nobody from {school.name} plays yet, so there&apos;s nothing to back this season. Check back once former pupils join.</p>
        )}
        {slots?.map((s) => {
          const on = pick?.slot.pool_id === s.pool_id && pick.round === null;
          if (!s.available) return (
            <div key={s.pool_id} className="opt taken">
              <div className="grow"><strong>{label(s)}</strong><div className="small muted">{s.players} player{s.players === 1 ? "" : "s"} · {s.taken_by ? `sponsored by ${s.taken_by}` : s.reason}</div></div>
              <div className="price quiet">{s.taken_by ? "Taken" : "Not yet"}</div>
            </div>
          );
          return (
            <button key={s.pool_id} type="button" className={`opt${on ? " sel" : ""}`} disabled={!s.price_minor}
              onClick={() => setPick({ slot: s, round: null, price: s.price_minor! })}>
              <div className="grow"><strong>{label(s)}</strong><div className="small muted">{s.players} player{s.players === 1 ? "" : "s"} · {what(s)}</div></div>
              {s.price_minor && <div className="price">{money(s.price_minor, s.currency)}<small>a season</small></div>}
            </button>
          );
        })}
        {roundSlot?.next_round && roundSlot.round_price_minor && (
          <button type="button" className={`opt${pick?.round ? " sel" : ""}`} disabled={!roundSlot.round_available}
            onClick={() => setPick({ slot: roundSlot, round: roundSlot.next_round, price: roundSlot.round_price_minor! })}>
            <div className="grow"><strong>Round {roundSlot.next_round} prize</strong>
              <div className="small muted">{label(roundSlot)}, one weekend · your prize, your name on it{roundSlot.round_available ? "" : " · taken"}</div></div>
            <div className="price">{money(roundSlot.round_price_minor, roundSlot.currency)}<small>a round</small></div>
          </button>
        )}
      </div>

      {pick && sp && school && (
        <div className="card narrow">
          <h2>Where {money(pick.price, cur)} goes</h2>
          <div className="split">
            <i style={{ width: "20%", background: "var(--accent)" }} /><i style={{ width: "20%", background: "var(--accent-dim)" }} />
            <i style={{ width: "20%", background: "var(--gold)" }} /><i style={{ width: "40%", background: "#3b4a44" }} />
          </div>
          <div className="legend2">
            <span><i className="d" style={{ background: "var(--accent)" }} />{school.name}</span><b>{money(sp.own, cur)}</b>
            <span><i className="d" style={{ background: "var(--accent-dim)" }} />{school.no_fee ? `${school.name} again, as a no-fee school` : partner ? `${partner.name}, a no-fee school${partner.town ? ` in ${partner.town}` : " nearby"}` : "A no-fee school nearby"}</span><b>{money(sp.partner, cur)}</b>
            <span><i className="d" style={{ background: "var(--gold)" }} />Prizes for the players, with your name on them</span><b>{money(sp.prizes, cur)}</b>
            <span><i className="d" style={{ background: "#3b4a44" }} />Scrumline, to run the game</span><b>{money(sp.scrumline, cur)}</b>
          </div>
          <p className="small muted">The schools&apos; {money(sp.own + sp.partner, cur)} is a donation with a section 18A tax certificate. The rest is advertising on one tax invoice.</p>
          <Link className="btn paybtn" href={`/sponsor/checkout/?pool=${pick.slot.pool_id}${pick.round ? `&round=${pick.round}` : ""}`}>
            Continue with {pick.round ? `round ${pick.round}` : pick.slot.kind === "school" ? "the whole school" : label(pick.slot)}
          </Link>
        </div>
      )}

      {mine.length > 0 && (
        <div className="card narrow">
          <h2>Your sponsorships</h2>
          {mine.map((m) => (
            <Link key={m.booking_id} className="rowline" href={`/sponsor/results/?b=${m.booking_id}`}>
              <span>{m.pool_name}{m.round ? `, round ${m.round}` : ""}<span className="small muted"> · {m.season_name}</span></span>
              <span className="small muted">{STATUS[m.status] ?? m.status}</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
