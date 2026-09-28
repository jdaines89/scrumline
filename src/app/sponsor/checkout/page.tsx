"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useLeague } from "@/components/league";
import { CATEGORIES, initials, money, query, split } from "@/lib/sponsor";
import { supabase } from "@/lib/supabase";

interface Quote { pool_id: number; pool_name: string; kind: string; players: number; price_minor: number | null; currency: string; available: boolean; taken_by: string | null }
interface Sponsor { id: number; name: string; category: string; email: string }

export default function Checkout() {
  const { season, me } = useLeague();
  const [pool, setPool] = useState<number | null>(null);
  const [round, setRound] = useState<number | null>(null);
  const [quote, setQuote] = useState<Quote | null | undefined>(undefined);
  const [sponsor, setSponsor] = useState<Sponsor | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [email, setEmail] = useState(me.email);
  const [offer, setOffer] = useState("");
  const [link, setLink] = useState("");
  const [prize, setPrize] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const p = Number(query("pool")); const r = Number(query("round"));
    if (!p) { setQuote(null); return; }
    setPool(p); setRound(r || null);
    supabase.rpc("sponsor_quote", { p_pool: p, p_round: r || null }).then(({ data }) => setQuote(((data ?? []) as Quote[])[0] ?? null));
    supabase.from("sponsors").select("id, name, category, email").order("created_at", { ascending: false }).limit(1)
      .then(({ data }) => {
        const s = (data?.[0] as Sponsor | undefined) ?? null;
        setSponsor(s);
        if (s) { setName(s.name); setCategory(s.category); setEmail(s.email); }
      });
  }, []);

  if (quote === undefined) return <div className="skeleton" style={{ height: 200 }} />;
  if (!quote || !quote.price_minor || !pool) return (
    <div className="card narrow"><h2>That slot isn&apos;t available</h2><Link className="btn" href="/sponsor/">Pick another</Link></div>
  );
  if (!quote.available) return (
    <div className="card narrow"><h2>{quote.pool_name} is sponsored by {quote.taken_by}</h2><Link className="btn" href="/sponsor/">Pick another</Link></div>
  );

  const price = quote.price_minor, cur = quote.currency, sp = split(price);

  async function pay(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    const url = link.trim() && !/^https:\/\//i.test(link.trim()) ? `https://${link.trim().replace(/^http:\/\//i, "")}` : link.trim();
    setBusy(true);
    try {
      let sid = sponsor?.id;
      if (!sid) {
        const { data, error } = await supabase.rpc("create_sponsor", { p_country: "ZA", p_name: name, p_category: category, p_email: email });
        if (error) throw new Error(error.message.includes("check") ? "Check the business name and email." : error.message);
        sid = data as number;
        setSponsor({ id: sid, name, category, email });
      }
      const hold = await supabase.rpc("hold_sponsor_slot", { p_sponsor: sid, p_pool: pool, p_round: round });
      if (hold.error) throw new Error(hold.error.message);
      const booking = hold.data as number;
      const saved = await supabase.rpc("save_sponsor_creative", { p_booking: booking, p_name: name, p_offer: offer, p_link: url, p_prize: prize });
      if (saved.error) throw new Error(saved.error.message.includes("check") ? "The link must be a web address, and the offer 80 characters at most." : saved.error.message);
      const back = `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/sponsor/results/?b=${booking}`;
      const { data, error } = await supabase.functions.invoke("sponsor-checkout", { body: { booking_id: booking, return_url: back } });
      if (error || !data?.url) {
        // Payments not switched on yet (or the provider is down): the slot stays held for 30 minutes.
        window.location.href = back;
        return;
      }
      window.location.href = data.url;
    } catch (err) {
      setMsg((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={pay}>
      <div className="card narrow">
        <p className="sp-kicker">{quote.pool_name}{round ? ` · round ${round}` : ""} · {season.name}</p>
        <h2>Your sponsorship</h2>
        <div className="field"><label>Business name, as players will see it</label>
          <input required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} disabled={!!sponsor} /></div>
        {!sponsor && <div className="field"><label>What the business does</label>
          <select required value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="" disabled>Pick one</option>
            {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></div>}
        <div className="field"><label>Logo</label>
          <div className="logo-drop"><div className="sp-tile">{initials(name || "?")}</div>
            <div className="small muted">Shown small, never as a banner. Send your logo after paying and we&apos;ll add it when we check the rest.</div></div></div>
        <div className="field"><label>One line for players (optional)</label>
          <input maxLength={80} placeholder="Paul Roos alumni: 15% off your next service" value={offer} onChange={(e) => setOffer(e.target.value)} /></div>
        <div className="field"><label>Link (optional)</label>
          <input maxLength={190} inputMode="url" placeholder="yourbusiness.co.za" value={link} onChange={(e) => setLink(e.target.value)} /></div>
        <div className="field"><label>Prizes, {money(sp.prizes, cur)}{round ? "" : " over the season"}</label>
          <input maxLength={80} placeholder="A car wash voucher or 5GB data" value={prize} onChange={(e) => setPrize(e.target.value)} /></div>
        {!sponsor && <div className="field"><label>Email for your receipts and results</label>
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>}
      </div>
      <div className="card narrow">
        <div className="rowline first"><span>Advertising and prizes, tax invoice</span><b>{money(sp.prizes + sp.scrumline, cur)}</b></div>
        <div className="rowline"><span>Donation to schools, 18A certificate</span><b>{money(sp.own + sp.twin, cur)}</b></div>
        <div className="rowline"><b>Total today</b><b>{money(price, cur)}</b></div>
        <p className="small muted">One card payment, split automatically. You&apos;re live as soon as we&apos;ve checked your name and line, usually the same day.</p>
        {msg && <p className="small" style={{ color: "var(--danger)" }}>{msg}</p>}
        <button className="paybtn" disabled={busy}>{busy ? "Opening the payment page…" : `Pay ${money(price, cur)} by card`}</button>
        <p className="small muted" style={{ textAlign: "center" }}>Visa, Mastercard, Instant EFT · secured by Paystack</p>
      </div>
    </form>
  );
}
