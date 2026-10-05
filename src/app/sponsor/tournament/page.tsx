"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { randsToMinor } from "@/lib/projects";
import { money, split } from "@/lib/sponsor";
import { useSponsorSeason } from "@/lib/sponsor-season";
import { supabase } from "@/lib/supabase";
import { roundName } from "@/lib/format";

interface Slot { round: number | null; first_kickoff: string | null; reserve_minor: number; taken: boolean; taken_by: string | null; open: boolean }
interface Business { id: number; name: string }
interface Application {
  id: number; season_id: string; season_name: string; round: number | null; sponsor: string; amount_minor: number; currency: string;
  offer: string | null; status: string; reply: string | null; pay_by: string | null; players_seen: number; taps: number;
}

const STATUS: Record<string, string> = {
  applied: "Waiting for Scrumline", approved: "Approved, waiting for payment", live: "Live", declined: "Declined",
  withdrawn: "Withdrawn", lapsed: "Not paid in time",
};
const day = (d: string) => new Date(d).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
const slotName = (r: number | null) => (r === null ? "The whole tournament" : `${roundName(r)}`);

/** Apply to present a whole tournament, or one round of it. Scrumline approves one business per slot. */
export default function SponsorTournament() {
  const { seasons, season, setSeason, loading } = useSponsorSeason();
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [businesses, setBusinesses] = useState<Business[] | null>(null);
  const [mine, setMine] = useState<Application[]>([]);
  const [pick, setPick] = useState<Slot | null>(null);

  const load = useCallback(() => {
    supabase.rpc("my_tournament_sponsors").then(({ data }) => setMine((data ?? []) as Application[]));
    if (!season) return;
    supabase.rpc("tournament_slots", { p_season: season.id }).then(({ data }) => {
      const ss = (data ?? []) as Slot[];
      setSlots(ss);
      setPick((p) => ss.find((s) => s.open && s.round === p?.round) ?? ss.find((s) => s.open) ?? null);
    });
  }, [season?.id]);
  useEffect(() => { setSlots(null); load(); }, [load]);
  useEffect(() => { supabase.rpc("my_businesses").then(({ data }) => setBusinesses((data ?? []) as Business[])); }, []);

  async function withdraw(id: number) {
    await supabase.rpc("withdraw_tournament_sponsor", { p_id: id });
    load();
  }

  if (loading) return <div className="skeleton" style={{ height: 200 }} />;
  if (!season) return <div className="card narrow"><h2>No tournament is open yet</h2><p className="sub">Check back when the next season is loaded.</p></div>;

  return (
    <>
      <div className="card narrow">
        <p className="sp-kicker">For businesses</p>
        <h2>Sponsor a tournament</h2>
        <p className="sub">Your name in front of every player in {season.name}, in every pool: on Home, Predict and the leaderboard. Take the whole tournament, or one round. Scrumline approves one business per slot, and you only pay once you&apos;re approved.</p>
        {seasons.length > 1 && (
          <label className="sp-season">
            <span className="small muted">Tournament</span>
            <select value={season.id} onChange={(e) => setSeason(e.target.value)}>
              {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}
        {slots === null && <div className="skeleton" style={{ height: 80 }} />}
        {slots?.map((s) => {
          const on = pick?.round === s.round;
          if (!s.open) return (
            <div key={s.round ?? 0} className="opt taken">
              <div className="grow"><strong>{slotName(s.round)}</strong><div className="small muted">{s.taken_by ? `Sponsored by ${s.taken_by}` : s.taken ? "Taken" : "Closed"}</div></div>
              <div className="price quiet">{s.taken ? "Taken" : "Closed"}</div>
            </div>
          );
          return (
            <button key={s.round ?? 0} type="button" className={`opt${on ? " sel" : ""}`} onClick={() => setPick(s)}>
              <div className="grow"><strong>{slotName(s.round)}</strong>
                <div className="small muted">{s.round === null ? `"${season.name} presented by" you, all season` : `"${roundName(s.round)} sponsored by" you${s.first_kickoff ? `, from now until ${day(s.first_kickoff)}'s kickoff and through the round` : ""}`}</div></div>
              <div className="price">from {money(s.reserve_minor)}</div>
            </button>
          );
        })}
      </div>

      {pick && businesses !== null && (businesses.length
        ? <ApplyForm key={`${season.id}:${pick.round}`} seasonId={season.id} slot={pick} businesses={businesses} onDone={load} />
        : <div className="card narrow"><p className="sub" style={{ margin: 0 }}>You apply in your business&apos;s name. <Link href="/sponsor/profile/">Set up your business profile</Link> first.</p></div>)}

      {mine.length > 0 && (
        <div className="card narrow">
          <h2>Your applications</h2>
          {mine.map((a) => (
            <div key={a.id} className="rowline">
              <span>
                {a.season_name} · {slotName(a.round)} · {money(a.amount_minor, a.currency)}
                <small className="muted block">
                  {a.sponsor} · {STATUS[a.status] ?? a.status}
                  {a.status === "approved" && a.pay_by ? `. Pay by ${day(a.pay_by)}; we'll email the payment details.` : ""}
                  {a.status === "live" ? ` · seen by ${a.players_seen} player${a.players_seen === 1 ? "" : "s"} · ${a.taps} tap${a.taps === 1 ? "" : "s"}` : ""}
                  {a.reply ? ` · "${a.reply}"` : ""}
                </small>
              </span>
              {(a.status === "applied" || a.status === "approved") && <button type="button" className="ghost" onClick={() => withdraw(a.id)}>Withdraw</button>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function ApplyForm({ seasonId, slot, businesses, onDone }: { seasonId: string; slot: Slot; businesses: Business[]; onDone: () => void }) {
  const [who, setWho] = useState(String(businesses[0].id));
  const [amount, setAmount] = useState(String(slot.reserve_minor / 100));
  const [offer, setOffer] = useState("");
  const [link, setLink] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const minor = randsToMinor(amount);
  const sp = minor ? split(minor) : null;

  async function apply(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    if (minor === null || minor < slot.reserve_minor) { setMsg({ ok: false, text: `The minimum for this slot is ${money(slot.reserve_minor)}.` }); return; }
    const url = link.trim() && !/^https:\/\//i.test(link.trim()) ? `https://${link.trim().replace(/^http:\/\//i, "")}` : link.trim();
    setBusy(true);
    const { error } = await supabase.rpc("apply_tournament_sponsor", {
      p_season: seasonId, p_round: slot.round, p_sponsor: Number(who), p_amount_minor: minor, p_offer: offer, p_link: url, p_note: note,
    });
    setBusy(false);
    if (error) { setMsg({ ok: false, text: error.message.includes("check") ? "Check the line and link. The link must start with https://." : error.message }); return; }
    setOffer(""); setLink(""); setNote("");
    setMsg({ ok: true, text: "Sent. Scrumline will approve or decline it, and you'll see the answer below." });
    onDone();
  }

  return (
    <form className="card narrow stack" onSubmit={apply}>
      <h2>Apply for {slotName(slot.round).toLowerCase()}</h2>
      {businesses.length > 1
        ? <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Business">{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        : <p className="small muted" style={{ margin: 0 }}>From {businesses[0].name}</p>}
      <label className="proj-amt"><span>R</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Your offer in rands" /></label>
      <p className="small muted" style={{ margin: 0 }}>Your offer. The minimum is {money(slot.reserve_minor)}; other businesses may apply too, and nobody sees another&apos;s offer.</p>
      <input maxLength={80} placeholder="One line for players (optional), e.g. 10% off with code SCRUM" value={offer} onChange={(e) => setOffer(e.target.value)} />
      <input maxLength={200} placeholder="Link for that line (optional), https://" value={link} onChange={(e) => setLink(e.target.value)} />
      <textarea maxLength={280} rows={2} placeholder="Anything Scrumline should know (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      {sp && minor! >= slot.reserve_minor && (
        <p className="small muted" style={{ margin: 0 }}>Of {money(minor!)}: {money(sp.own + sp.partner)} to schools, {money(sp.prizes)} to prizes for players with your name on them, {money(sp.scrumline)} to Scrumline.</p>
      )}
      <div><button type="submit" disabled={busy}>{busy ? "Sending…" : "Apply"}</button></div>
      {msg && <p className="small" style={{ margin: 0, color: msg.ok ? "var(--accent)" : "var(--danger)" }}>{msg.text}</p>}
    </form>
  );
}
