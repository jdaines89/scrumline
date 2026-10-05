"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { SchoolSearch } from "@/components/school-search";
import { rememberPickedSchool, ROLES } from "@/lib/school";
import { supabase } from "@/lib/supabase";
import type { School } from "@/lib/types";

/** Where a school's contact signs up to claim it. Open to anyone; the account only reaches that school's pages. */
export default function SchoolSignUp() {
  const [school, setSchool] = useState<School | null>(null);
  const [contact, setContact] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!school) return;
    setBusy(true); setMsg(null);
    rememberPickedSchool(school);
    const { data, error } = await supabase.functions.invoke("business-signup", { body: { kind: "school", contact, role, email } });
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
      <p className="sp-kicker">For schools</p>
      <h2>Check your email</h2>
      <p className="sub">We sent a link to {email}. Open it on this device to choose a password, and {school?.name ?? "your school"} will be waiting.</p>
      <p className="small muted" style={{ marginBottom: 0 }}>Nothing after a few minutes? Look in spam, or <button type="button" className="linkish" onClick={() => setDone(false)}>try again</button>.</p>
    </div>
  );

  return (
    <>
      <div className="card narrow">
        <p className="sp-kicker">For schools</p>
        <h2>Claim your school on Scrumline</h2>
        <p className="sub">See what sponsors have raised for your school, have it paid into the school&apos;s bank account every month, and share it with your former pupils. It costs the school nothing.</p>
        <div className="stack">
          {school ? (
            <div className="school-saved">
              <div><div className="school-name">{school.name}</div><div className="small muted">{[school.town, school.no_fee ? "no-fee school" : null].filter(Boolean).join(" · ")}</div></div>
              <button type="button" className="ghost" onClick={() => setSchool(null)}>Other school</button>
            </div>
          ) : (
            <>
              <SchoolSearch signedOut onPick={setSchool} placeholder="Start with your school's name" />
              <p className="small muted" style={{ margin: 0 }}>Every public and independent school in the Department of Basic Education&apos;s list is here.</p>
            </>
          )}
        </div>
        {school && (
          <form onSubmit={submit} className="stack" style={{ marginTop: 12 }}>
            <input required minLength={2} maxLength={60} placeholder="Your name" autoComplete="name" value={contact} onChange={(e) => setContact(e.target.value)} />
            <select required value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="" disabled>Your role at the school</option>
              {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input type="email" required placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button type="submit" disabled={busy}>{busy ? "Sending…" : "Email me a link"}</button>
          </form>
        )}
        {msg && <p className="small" style={{ color: "var(--danger)", marginBottom: 0 }}>{msg}</p>}
      </div>
      <div className="card narrow biz-points">
        <div><strong>Checked, not trusted</strong><span className="small muted">Money only goes to an account in the school&apos;s own name, confirmed by the bank. For a week after you claim, players from your school see who claimed it and can flag it.</span></div>
        <div><strong>Paid monthly, confirmed by you</strong><span className="small muted">One transfer a month into the school&apos;s account. You tap Received when it lands, and Giving shows every payment and every confirmation.</span></div>
        <div><strong>Bring your alumni</strong><span className="small muted">A ready message for your old pupils&apos; WhatsApp groups, and a link for parents who own a business to back the school.</span></div>
      </div>
      <div className="card narrow">
        <h2>No-fee schools</h2>
        <p className="sub" style={{ marginBottom: 0 }}>No-fee schools don&apos;t have to do any of this online. We phone or WhatsApp the school in its own language, and a school can take its share as goods it chooses, like balls, kit or data, instead of cash.</p>
      </div>
      <p className="small muted center">Already signed up? <Link href="/school/">Sign in</Link></p>
    </>
  );
}
