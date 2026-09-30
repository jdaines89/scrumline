"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { SponsorTile } from "@/components/sponsor-tile";
import { CATEGORIES, extraFee, money, query, split } from "@/lib/sponsor";
import { useSponsorSeason } from "@/lib/sponsor-season";
import { supabase } from "@/lib/supabase";

interface Quote { pool_id: number; pool_name: string; kind: string; players: number; price_minor: number | null; currency: string; available: boolean; taken_by: string | null; reason: string | null }
interface Sponsor { id: number; name: string; category: string; email: string; logo_path?: string | null }

export default function Checkout() {
  const { season } = useSponsorSeason();
  const [pool, setPool] = useState<number | null>(null);
  const [round, setRound] = useState<number | null>(null);
  const [quote, setQuote] = useState<Quote | null | undefined>(undefined);
  const [sponsor, setSponsor] = useState<Sponsor | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [email, setEmail] = useState("");
  const [offer, setOffer] = useState("");
  const [link, setLink] = useState("");
  const [prize, setPrize] = useState("");
  const [extra, setExtra] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const p = Number(query("pool")); const r = Number(query("round"));
    if (!p) { setQuote(null); return; }
    setPool(p); setRound(r || null);
    supabase.rpc("sponsor_quote", { p_pool: p, p_round: r || null }).then(({ data }) => setQuote(((data ?? []) as Quote[])[0] ?? null));
    supabase.from("sponsors").select("id, name, category, email, logo_path").order("created_at", { ascending: false }).limit(1)
      .then(({ data }) => {
        const s = (data?.[0] as Sponsor | undefined) ?? null;
        setSponsor(s);
        if (s) { setName(s.name); setCategory(s.category); setEmail(s.email); return; }
        // First time: start from the account's own email and, for a business, its name.
        supabase.auth.getUser().then(({ data: u }) => {
          const meta = u.user?.user_metadata ?? {};
          setEmail((v) => v || u.user?.email || "");
          if (meta.kind === "business" && typeof meta.business_name === "string") setName((v) => v || meta.business_name);
        });
      });
  }, []);

  if (quote === undefined) return <div className="skeleton" style={{ height: 200 }} />;
  if (!quote || !quote.price_minor || !pool) return (
    <div className="card narrow"><h2>That slot isn&apos;t available</h2><Link className="btn" href="/sponsor/">Pick another</Link></div>
  );
  if (!quote.available) return (
    <div className="card narrow"><h2>{quote.taken_by ? `${quote.pool_name} is sponsored by ${quote.taken_by}` : quote.reason}</h2><Link className="btn" href="/sponsor/">Pick another</Link></div>
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
      if (extra > 0) {
        const d = await supabase.rpc("set_booking_donation", { p_booking: booking, p_extra_minor: extra });
        if (d.error) throw new Error(d.error.message);
      }
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
        <p className="sp-kicker">{quote.pool_name}{round ? ` · round ${round}` : ""}{season ? ` · ${season.name}` : ""}</p>
        <h2>Your sponsorship</h2>
        <div className="field"><label>Business name, as players will see it</label>
          <input required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} disabled={!!sponsor} /></div>
        {!sponsor && <div className="field"><label>Industry</label>
          <select required value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="" disabled>Select an industry</option>
            {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></div>}
        <div className="field"><label>Logo</label>
          <div className="logo-drop"><SponsorTile name={name} logo={sponsor?.logo_path ?? null} />
            <div className="small muted">Shown small, never as a banner. {sponsor?.logo_path ? "Change it" : "Add it"}, with a few lines about you, on <Link href="/sponsor/profile/">your profile</Link>.</div></div></div>
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
        <div className="rowline first"><span>Donation to schools<small className="muted block">All of it reaches the schools. Section 18A certificate.</small></span><b>{money(sp.own + sp.partner, cur)}</b></div>
        <div className="rowline"><span>Advertising and player prizes<small className="muted block">Tax invoice.</small></span><b>{money(sp.prizes + sp.scrumline, cur)}</b></div>
        <div className="rowline extra-row">
          <span>Add an extra donation?<small className="muted block">Optional. We take nothing from it. Only the 3.5% card fee comes off{extra ? `, so ${money(extra - extraFee(extra), cur)} reaches the schools you back` : ""}.</small></span>
          <b>{extra ? money(extra, cur) : "None"}</b>
        </div>
        <div className="chips">
          {[0, 25000, 50000, 100000].map((v) => (
            <button key={v} type="button" className={extra === v ? "on" : ""} onClick={() => setExtra(v)}>{v ? money(v, cur) : "No thanks"}</button>
          ))}
          <input inputMode="numeric" placeholder="Other, R" aria-label="Other amount in rand"
            value={[0, 25000, 50000, 100000].includes(extra) ? "" : String(extra / 100)}
            onChange={(e) => { const n = Math.floor(Number(e.target.value.replace(/[^\d]/g, "")) || 0); setExtra(Math.min(n, 100000) * 100); }} />
        </div>
        <div className="rowline"><b>Total today</b><b>{money(price + extra, cur)}</b></div>
        <p className="small muted">One card payment, split automatically. You go live the moment your payment clears.</p>
        {msg && <p className="small" style={{ color: "var(--danger)" }}>{msg}</p>}
        <button className="paybtn" disabled={busy}>{busy ? "Opening the payment page…" : `Pay ${money(price + extra, cur)} by card`}</button>
        <p className="small muted" style={{ textAlign: "center" }}>Visa, Mastercard, Instant EFT · secured by Paystack</p>
      </div>
    </form>
  );
}
