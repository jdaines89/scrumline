"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";

/** Where a business signs itself up. Open to anyone; the account it makes only reaches the sponsor pages. */
export default function BusinessSignUp() {
  const [business, setBusiness] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.functions.invoke("business-signup", { body: { business, email } });
    setBusy(false);
    if (error || !data?.ok) {
      const body = await (error as { context?: Response } | null)?.context?.json?.().catch(() => null);
      setMsg(body?.error ?? data?.error ?? "Something went wrong. Try again in a minute.");
      return;
    }
    setDone(true);
  }

  if (done) return (
    <div className="card narrow">
      <p className="sp-kicker">For businesses</p>
      <h2>Check your email</h2>
      <p className="sub">We sent a link to {email}. Open it on this device to choose a password, then find your school.</p>
      <p className="small muted" style={{ marginBottom: 0 }}>Nothing after a few minutes? Look in spam, or <button type="button" className="linkish" onClick={() => setDone(false)}>try again</button>.</p>
    </div>
  );

  return (
    <>
      <div className="card narrow">
        <p className="sp-kicker">For businesses</p>
        <h2>Back a school on Scrumline</h2>
        <p className="sub">Your name in front of a school&apos;s former pupils all season, on their pool, their table and the round cards they share.</p>
        <form onSubmit={submit} className="stack">
          <input required minLength={2} maxLength={60} placeholder="Business name" autoComplete="organization" value={business} onChange={(e) => setBusiness(e.target.value)} />
          <input type="email" required placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="submit" disabled={busy}>{busy ? "Sending…" : "Email me a sign-up link"}</button>
        </form>
        {msg && <p className="small" style={{ color: "var(--danger)", marginBottom: 0 }}>{msg}</p>}
      </div>
      <div className="card narrow">
        <h2>Where every rand goes</h2>
        <div className="split">
          <i style={{ width: "20%", background: "var(--accent)" }} /><i style={{ width: "20%", background: "var(--accent-dim)" }} />
          <i style={{ width: "20%", background: "var(--gold)" }} /><i style={{ width: "40%", background: "#3b4a44" }} />
        </div>
        <div className="legend2">
          <span className="grp">Donation to schools, all of it reaches them</span>
          <span><i className="d" style={{ background: "var(--accent)" }} />The school you pick</span><b>20%</b>
          <span><i className="d" style={{ background: "var(--accent-dim)" }} />A no-fee school near it</span><b>20%</b>
          <span className="grp">Advertising</span>
          <span><i className="d" style={{ background: "var(--gold)" }} />Prizes for the players, in your name</span><b>20%</b>
          <span><i className="d" style={{ background: "#3b4a44" }} />Scrumline: the app, results, payments and support</span><b>40%</b>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>Want to give more? Add an extra donation at checkout: 100% of it goes to the school. Schools are paid monthly, and your results page shows each payment and when the school confirms it.</p>
      </div>
      <div className="card narrow biz-points">
        <div><strong>No calls, no forms</strong><span className="small muted">Pick a school, see the price and pay by card. It goes live straight away.</span></div>
        <div><strong>See it working</strong><span className="small muted">A results page and a Monday email: how often you were seen, by how many players, and taps to your site.</span></div>
        <div><strong>Players never see your details</strong><span className="small muted">Only your business name, your line and your prize. Your account never sees theirs either.</span></div>
      </div>
      <p className="small muted center">Already signed up? <Link href="/sponsor/">Sign in</Link></p>
    </>
  );
}
