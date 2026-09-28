"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { SchoolSearch } from "@/components/school-search";
import { SAMPLE_DASHBOARD, SAMPLE_PAYOUTS, usePreview } from "@/lib/preview";
import { type Dashboard, type Payout } from "@/lib/school";
import { money } from "@/lib/sponsor";
import { supabase } from "@/lib/supabase";
import type { School } from "@/lib/types";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });

const PAYOUT: Record<string, string> = {
  pending: "Being prepared", sent: "On its way", paid: "Arrived?", failed: "Didn't go through; paid next month", confirmed: "Confirmed by you",
};

/** A school's own page: pick the school, add its bank account, then see and share what it has raised. */
export default function SchoolPage() {
  const preview = usePreview();
  const [emis, setEmis] = useState<string | null | undefined>(undefined);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const acct = await supabase.from("school_accounts").select("emis").maybeSingle();
    if (!acct.data) { setEmis(""); return; }
    setEmis((acct.data.emis as string | null) ?? null);
    if (!acct.data?.emis) return;
    const [d, p] = await Promise.all([
      supabase.rpc("school_dashboard"),
      supabase.from("school_payouts").select("id, amount_minor, currency, status, created_at, paid_at, confirmed_at, note").order("created_at", { ascending: false }),
    ]);
    setDash(((d.data ?? []) as Dashboard[])[0] ?? null);
    setPayouts((p.data ?? []) as Payout[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const d = preview ? SAMPLE_DASHBOARD : dash;
  const ps = preview ? SAMPLE_PAYOUTS : payouts;

  if (!preview && emis === undefined) return <div className="skeleton" style={{ height: 200 }} />;
  if (!preview && emis === "") return (
    <div className="card narrow">
      <h2>Look after your school&apos;s account?</h2>
      <p className="sub">Principals, bursars, governing bodies and alumni offices can claim the school and receive what sponsors give it.</p>
      <Link className="btn" href="/schools/">Claim your school</Link>
    </div>
  );
  if (!preview && !emis) return <PickSchool onDone={load} />;
  if (!d) return <div className="skeleton" style={{ height: 200 }} />;

  async function received(id: number) {
    if (id < 0) return;
    const { error } = await supabase.rpc("confirm_school_payout", { p_payout: id });
    if (error) { setMsg(error.message); return; }
    load();
  }

  const claimed = d.claim_status === "verified" || d.claim_status === "needs_review";
  const onNotice = d.claim_status === "verified" && d.notice_until && new Date(d.notice_until) > new Date();
  return (
    <>
      <div className="card narrow">
        <p className="sp-kicker">Your school</p>
        <h2>{d.name}</h2>
        <p className="sub">{d.town ? `${d.town} · ` : ""}{d.players} player{d.players === 1 ? "" : "s"} on Scrumline</p>
        {d.claim_status === "needs_review" && <p className="notice small">We&apos;re checking your claim{d.review_reason ? `: ${d.review_reason.toLowerCase()}` : ""}. We&apos;ll email you, and nothing is paid out until it&apos;s sorted.</p>}
        {onNotice && <p className="notice small">Claimed. For a week, players from {d.name} can see that you claimed it. Payouts start after {day(d.notice_until!)}.</p>}
        <div className="school-stats">
          <div><b>{money(d.raised_minor)}</b><span className="small muted">Raised by sponsors</span></div>
          <div><b>{money(d.paid_minor)}</b><span className="small muted">Paid to the school</span></div>
          <div><b>{money(d.waiting_minor)}</b><span className="small muted">In the next payout</span></div>
        </div>
        {d.sponsors.length > 0
          ? <p className="small muted" style={{ marginBottom: 0 }}>Backed by {d.sponsors.join(", ")}.</p>
          : <p className="small muted" style={{ marginBottom: 0 }}>No sponsor yet. Share the link below with parents and former pupils who own a business.</p>}
      </div>

      {!claimed && <BankForm dash={d} onDone={load} />}

      {ps.length > 0 && (
        <div className="card narrow">
          <h2>Payments to the school</h2>
          {ps.map((p) => (
            <div key={p.id} className="rowline">
              <span>{money(p.amount_minor, p.currency)}<small className="muted block">{day(p.paid_at ?? p.created_at)}{p.note ? ` · ${p.note}` : ""}</small></span>
              {p.status === "paid"
                ? <button type="button" onClick={() => received(p.id)}>It arrived</button>
                : <span className={`small ${p.status === "confirmed" ? "pos" : "muted"}`}>{PAYOUT[p.status] ?? p.status}</span>}
            </div>
          ))}
          {msg && <p className="small" style={{ color: "var(--danger)" }}>{msg}</p>}
          <p className="small muted" style={{ marginBottom: 0 }}>Tap It arrived once a payment shows in the school&apos;s account. <Link href="/giving/">Giving</Link> shows it as confirmed by the school.</p>
        </div>
      )}

      <ShareCard dash={d} />

      <div className="card narrow">
        <h2>{d.no_fee ? "Both shares are yours" : "Your partner school"}</h2>
        <p className="sub" style={{ marginBottom: 0 }}>
          {d.no_fee
            ? `${d.name} is a no-fee school, so it keeps its own 20% and the 20% for a partner school.`
            : d.partner_name
              ? `Every sponsor of ${d.name} also gives 20% to ${d.partner_name}, a no-fee school${d.partner_town ? ` in ${d.partner_town}` : " nearby"}.`
              : `Every sponsor of ${d.name} also gives 20% to a no-fee school nearby. We're still pairing yours.`}
        </p>
        {claimed && d.account_last4 && <p className="small muted" style={{ marginBottom: 0 }}>Paid into {d.bank_name} ··{d.account_last4}, {d.account_name}. To change it, email us.</p>}
      </div>
    </>
  );
}

function PickSchool({ onDone }: { onDone: () => void }) {
  const [pick, setPick] = useState<School | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  async function save() {
    if (!pick) return;
    const { error } = await supabase.rpc("set_school_account_school", { p_emis: pick.emis });
    if (error) { setMsg(error.message); return; }
    onDone();
  }
  return (
    <div className="card narrow">
      <p className="sp-kicker">Your school</p>
      <h2>Which school do you look after?</h2>
      <p className="sub">Every public and independent school in the Department of Basic Education&apos;s list is here.</p>
      {pick ? (
        <>
          <div className="school-saved">
            <div><div className="school-name">{pick.name}</div><div className="small muted">{pick.town}</div></div>
            <button type="button" className="ghost" onClick={() => setPick(null)}>Other school</button>
          </div>
          <button type="button" className="paybtn" onClick={save}>This is my school</button>
        </>
      ) : <SchoolSearch onPick={setPick} />}
      {msg && <p className="small" style={{ color: "var(--danger)" }}>{msg}</p>}
    </div>
  );
}

interface Bank { name: string; code: string }

function BankForm({ dash, onDone }: { dash: Dashboard; onDone: () => void }) {
  const [banks, setBanks] = useState<Bank[] | null>(null);
  const [off, setOff] = useState(false);
  const [bank, setBank] = useState("");
  const [number, setNumber] = useState("");
  const [holder, setHolder] = useState(dash.name);
  const [registration, setRegistration] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(dash.claim_status === "rejected" ? `Your last claim wasn't accepted${dash.review_reason ? `: ${dash.review_reason}` : ""}.` : null);

  useEffect(() => {
    supabase.functions.invoke("school-bank", { body: { action: "banks" } }).then(({ data, error }) => {
      if (error || !data?.banks) { setOff(true); return; }
      setBanks(data.banks as Bank[]);
    });
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const b = banks?.find((x) => x.code === bank);
    const { data, error } = await supabase.functions.invoke("school-bank", { body: {
      action: "claim", bank_code: bank, bank_name: b?.name ?? "", account_number: number, account_name: holder, registration,
    } });
    setBusy(false);
    if (error || !data?.status) {
      const body = await (error as { context?: Response } | null)?.context?.json?.().catch(() => null);
      setMsg(body?.error ?? "Something went wrong. Try again in a minute.");
      return;
    }
    onDone();
  }

  return (
    <form className="card narrow" onSubmit={submit}>
      <h2>Where should we pay {dash.name}?</h2>
      <p className="sub">The school&apos;s own bank account, in the school&apos;s name. We check it with the bank, and we only keep the last 4 digits.</p>
      {off ? (
        <p className="notice small" style={{ marginBottom: 0 }}>Bank details open when payments switch on. Your school is saved, and what it raises is kept for it until then.</p>
      ) : (
        <div className="stack">
          <select required value={bank} onChange={(e) => setBank(e.target.value)} disabled={!banks}>
            <option value="" disabled>{banks ? "Bank" : "Loading banks…"}</option>
            {banks?.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
          </select>
          <input required inputMode="numeric" placeholder="Account number" value={number} onChange={(e) => setNumber(e.target.value.replace(/[^\d ]/g, ""))} />
          <div className="field"><label>Name on the account</label>
            <input required maxLength={100} value={holder} onChange={(e) => setHolder(e.target.value)} /></div>
          <div className="field"><label>School registration or NPO number (optional)</label>
            <input maxLength={40} placeholder="As the bank has it" value={registration} onChange={(e) => setRegistration(e.target.value)} />
            <span className="small muted">With it, the bank can confirm the account straight away. Without it, a person checks the claim first.</span></div>
          <button type="submit" disabled={busy}>{busy ? "Checking with the bank…" : "Check and save"}</button>
        </div>
      )}
      {msg && <p className="small" style={{ color: "var(--danger)", marginBottom: 0 }}>{msg}</p>}
    </form>
  );
}

function ShareCard({ dash }: { dash: Dashboard }) {
  const site = typeof window === "undefined" ? "" : `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}`;
  const [copied, setCopied] = useState(false);
  const raised = dash.raised_minor > 0 ? ` Sponsors have already raised ${money(dash.raised_minor)} for the school.` : "";
  const text = `Former pupils of ${dash.name}: call the rugby scores on Scrumline and play for the school.${raised} Every sponsor gives 20% to ${dash.name} and 20% to a no-fee school nearby. ${site}/`;
  const biz = `Own a business? Back ${dash.name} on Scrumline. Of what you pay, 20% goes to ${dash.name}, 20% to a no-fee school nearby, 20% to prizes for players and 40% runs Scrumline: ${site}/business/`;
  async function copy(t: string) {
    try { await navigator.clipboard.writeText(t); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ }
  }
  return (
    <div className="card narrow">
      <h2>Tell your former pupils</h2>
      <p className="share-text">{text}</p>
      <div className="row">
        <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">Share on WhatsApp</a>
        <button type="button" className="ghost" onClick={() => copy(text)}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <p className="small muted" style={{ marginBottom: 6 }}>For parents and former pupils who own a business:</p>
      <div className="row">
        <a className="btn ghostlink" href={`https://wa.me/?text=${encodeURIComponent(biz)}`} target="_blank" rel="noreferrer">Ask a business to sponsor</a>
      </div>
    </div>
  );
}
