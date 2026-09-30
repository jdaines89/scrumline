"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { projectPhotoUrl, randsToMinor, STATE_LABEL, type Evidence, type Project } from "@/lib/projects";
import { money } from "@/lib/sponsor";
import { supabase } from "@/lib/supabase";

export interface Business { id: number; name: string }

const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });

/**
 * One school project: what it is, how far the pledges have got, who backed
 * it, the proof, and (while it's open) the pledge form.
 */
export function ProjectCard({ p, businesses, asMe, onChange }: {
  p: Project; businesses: Business[] | null; asMe: string | null; onChange: () => void;
}) {
  const left = Math.max(0, p.target_minor - p.pledged_minor);
  const pct = Math.min(100, Math.round((p.pledged_minor / p.target_minor) * 100));
  const photos = p.evidence.filter((e) => e.image_path);
  const notes = p.evidence.filter((e) => !e.image_path && e.note);
  const canBack = p.state === "open" && (asMe !== null || (businesses?.length ?? 0) > 0);

  async function withdraw(id: number) {
    const { error } = await supabase.rpc("withdraw_pledge", { p_pledge: id });
    if (!error) onChange();
  }

  return (
    <div className="card project">
      <div className="proj-head">
        <div>
          <h3>{p.title}</h3>
          <span className="small muted">{[p.school, p.town, p.no_fee ? "no-fee school" : null].filter(Boolean).join(" · ")}</span>
        </div>
        <span className={`proj-state ${p.state}`}>{STATE_LABEL[p.state]}</span>
      </div>
      <p className="proj-why">{p.why}</p>
      <p className="small">{p.items} <span className="muted">· from {p.supplier}</span></p>
      <p className="small muted proj-cost">{money(p.price_minor, p.currency)} for the items + {money(p.fee_minor, p.currency)} Scrumline project fee ({p.fee_bps / 100}%)</p>

      <div className="proj-bar" aria-label={`${pct}% pledged`}><span style={{ width: `${pct}%` }} /></div>
      <div className="proj-nums small">
        <span><b>{money(p.pledged_minor, p.currency)}</b> of {money(p.target_minor, p.currency)} pledged</span>
        <span className="muted">
          {p.state === "open" ? `closes ${day(p.deadline)}`
            : p.state === "funded" ? `${money(p.paid_minor, p.currency)} paid`
            : p.state === "missed" ? "not fully backed, so nobody paid" : ""}
        </span>
      </div>

      {p.backers.length > 0 && (
        <ul className="proj-backers">
          {p.backers.map((b) => (
            <li key={b.id} className={b.status === "lapsed" ? "lapsed" : ""}>
              <span>{b.mine ? `${b.name} (you)` : b.name}</span>
              <span className="muted">
                {money(b.amount_minor, p.currency)}
                {b.status === "paid" ? " · paid" : b.status === "lapsed" ? " · not paid" : p.state === "funded" ? " · to pay" : ""}
              </span>
              {b.mine && b.status === "pledged" && p.state === "open" && (
                <button type="button" className="linkish small" onClick={() => withdraw(b.id)}>Withdraw</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {(photos.length > 0 || notes.length > 0) && (
        <div className="proj-proof">
          {photos.map((e) => <ProofPhoto key={`${e.at}${e.image_path}`} e={e} />)}
          {notes.map((e) => <p key={e.at} className="small muted">{day(e.at.slice(0, 10))}: {e.note}</p>)}
        </div>
      )}

      {canBack && <PledgeForm p={p} left={left} businesses={businesses ?? []} asMe={asMe} onDone={onChange} />}
      {p.state === "open" && !canBack && businesses !== null && asMe === null && (
        <p className="small muted" style={{ marginBottom: 0 }}>Projects are backed in a business&apos;s name. <Link href="/sponsor/profile/">Set up your business profile</Link> first.</p>
      )}
    </div>
  );
}

function ProofPhoto({ e }: { e: Evidence }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { if (e.image_path) projectPhotoUrl(e.image_path).then(setUrl); }, [e.image_path]);
  return (
    <figure>
      {url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={e.note ?? "Project photo"} /></a> : <div className="skeleton" />}
      <figcaption className="small muted">{e.kind === "delivery" ? "Delivered" : e.kind === "order" ? "Ordered" : e.kind === "quote" ? "Quote" : "Update"}{e.note ? `: ${e.note}` : ""}</figcaption>
    </figure>
  );
}

function PledgeForm({ p, left, businesses, asMe, onDone }: {
  p: Project; left: number; businesses: Business[]; asMe: string | null; onDone: () => void;
}) {
  const [amount, setAmount] = useState(String(left / 100));
  const [who, setWho] = useState<string>(businesses[0] ? String(businesses[0].id) : "me");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function pledge(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    const minor = randsToMinor(amount);
    if (minor === null) { setMsg("Type an amount in rands."); return; }
    setBusy(true);
    const { error } = await supabase.rpc("pledge_project", { p_project: p.id, p_amount_minor: minor, p_sponsor: who === "me" ? null : Number(who) });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    onDone();
  }

  return (
    <form className="proj-pledge" onSubmit={pledge}>
      <div className="row">
        <label className="proj-amt"><span>R</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount in rands" /></label>
        <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Back as">
          {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          {asMe !== null && <option value="me">{asMe} (you)</option>}
        </select>
        <button type="submit" disabled={busy}>{busy ? "Pledging…" : "Pledge"}</button>
      </div>
      <p className="small muted">Nobody pays until the whole {money(p.target_minor, p.currency)} is pledged. Then each backer gets payment details, the items are bought from {p.supplier}, and a photo is posted when they arrive. The project fee pays for sourcing, ordering and the proof.</p>
      {msg && <p className="small" style={{ color: "var(--danger)" }}>{msg}</p>}
    </form>
  );
}
