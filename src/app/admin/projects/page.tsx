"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { useLeague } from "@/components/league";
import { SchoolSearch } from "@/components/school-search";
import { shrinkPhoto } from "@/lib/photo";
import { randsToMinor, STATE_LABEL, useProjects, type Project } from "@/lib/projects";
import { money } from "@/lib/sponsor";
import { supabase } from "@/lib/supabase";
import type { School } from "@/lib/types";

type Say = (ok: boolean, text: string) => void;

/** The Foundation's side of school projects: list one, settle pledges, order, and post the proof. */
export default function AdminProjects() {
  const { me } = useLeague();
  const [projects, reload] = useProjects();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!me.is_admin) return <div className="card narrow"><h2>Admins only</h2></div>;
  const say: Say = (ok, text) => { setMsg({ ok, text }); reload(); };

  return (
    <>
      <NewProject say={say} />
      {msg && <p className="small center" style={{ color: msg.ok ? "var(--accent)" : "var(--danger)" }}>{msg.text}</p>}
      {projects?.filter((p) => p.state !== "cancelled").map((p) => <ManageProject key={p.id} p={p} say={say} />)}
    </>
  );
}

function NewProject({ say }: { say: Say }) {
  const [school, setSchool] = useState<School | null>(null);
  const [title, setTitle] = useState("");
  const [why, setWhy] = useState("");
  const [items, setItems] = useState("");
  const [supplier, setSupplier] = useState("");
  const [price, setPrice] = useState("");
  const [deadline, setDeadline] = useState(() => new Date(Date.now() + 45 * 864e5).toISOString().slice(0, 10));

  async function create(e: FormEvent) {
    e.preventDefault();
    const target = randsToMinor(price);
    if (!school || target === null) { say(false, "Pick a school and type the supplier's price in rands."); return; }
    const { error } = await supabase.rpc("admin_create_project", {
      p_emis: school.emis, p_title: title, p_why: why, p_items: items, p_supplier: supplier, p_target_minor: target, p_deadline: deadline,
    });
    if (error) { say(false, error.message.includes("check") ? "Check every field. The price must be between R100 and R25,000." : error.message); return; }
    setSchool(null); setTitle(""); setWhy(""); setItems(""); setSupplier(""); setPrice("");
    say(true, "Project listed. It shows on the Giving page now.");
  }

  return (
    <form className="card narrow stack" onSubmit={create}>
      <p className="sp-kicker">Admin</p>
      <h2>List a school project</h2>
      <p className="sub">Only fixed-price items from a supplier&apos;s quote, up to R25,000. No building work.</p>
      {school
        ? <div className="row"><strong className="grow">{school.name}</strong><button type="button" className="ghost" onClick={() => setSchool(null)}>Change</button></div>
        : <SchoolSearch onPick={setSchool} placeholder="Find the school" />}
      <input required maxLength={60} placeholder="Title, e.g. Match balls for the U16s" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea required maxLength={280} rows={2} placeholder="Why the school needs it" value={why} onChange={(e) => setWhy(e.target.value)} />
      <input required maxLength={280} placeholder="Exactly what's bought, e.g. 20 Gilbert size-5 match balls" value={items} onChange={(e) => setItems(e.target.value)} />
      <input required maxLength={80} placeholder="Supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
      <div className="row">
        <input required inputMode="decimal" placeholder="Price incl. delivery (R)" value={price} onChange={(e) => setPrice(e.target.value)} />
        <input required type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} aria-label="Closes on" />
      </div>
      <div><button type="submit">List project</button></div>
    </form>
  );
}

function ManageProject({ p, say }: { p: Project; say: Say }) {
  const [kind, setKind] = useState<"quote" | "order" | "delivery" | "note">(p.state === "ordered" ? "delivery" : p.state === "funded" ? "order" : "quote");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function rpc(fn: string, args: Record<string, unknown>, done: string) {
    const { error } = await supabase.rpc(fn, args);
    say(!error, error ? error.message : done);
  }

  async function post(e: ChangeEvent<HTMLInputElement> | null) {
    const file = e?.target.files?.[0];
    if (e) e.target.value = "";
    if (!file && !note.trim()) return;
    setBusy(true);
    let path: string | null = null;
    try {
      if (file) {
        const blob = await shrinkPhoto(file);
        path = `${p.id}/${crypto.randomUUID()}.jpg`;
        const up = await supabase.storage.from("project-photos").upload(path, blob, { contentType: "image/jpeg" });
        if (up.error) throw new Error("Couldn't upload that photo.");
      }
      await rpc("admin_add_evidence", { p_project: p.id, p_kind: kind, p_note: note, p_image_path: path }, "Posted to the project's record.");
      setNote("");
    } catch (err) {
      say(false, (err as Error).message);
    }
    setBusy(false);
  }

  return (
    <div className="card narrow">
      <div className="proj-head">
        <div><h3>{p.title}</h3><span className="small muted">{p.school} · {money(p.pledged_minor)} of {money(p.target_minor)} · {money(p.paid_minor)} paid</span></div>
        <span className={`proj-state ${p.state}`}>{STATE_LABEL[p.state]}</span>
      </div>
      {p.backers.map((b) => (
        <div key={b.id} className="rowline">
          <span>{b.name}<small className="muted block">{money(b.amount_minor)} · {b.status}</small></span>
          {b.status === "pledged" && p.funded_once && (p.state === "funded" || p.state === "open") && (
            <span className="row">
              <button type="button" className="ghost" onClick={() => rpc("admin_settle_pledge", { p_pledge: b.id, p_status: "paid" }, `${b.name} marked paid.`)}>Paid</button>
              <button type="button" className="ghost" onClick={() => rpc("admin_settle_pledge", { p_pledge: b.id, p_status: "lapsed" }, `${b.name} marked not paid. Their amount is open again.`)}>Not paid</button>
            </span>
          )}
        </div>
      ))}
      {p.state !== "delivered" && (
        <div className="stack" style={{ marginTop: 10 }}>
          <div className="row">
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="What this is">
              <option value="quote">Quote</option><option value="order">Order</option><option value="delivery">Delivery</option><option value="note">Update</option>
            </select>
            <input className="grow" maxLength={280} placeholder="Note, e.g. Handed to the coach on 12 Oct" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="row">
            <label className="btn ghostlink">{busy ? "Posting…" : "Post with photo"}<input type="file" accept="image/*" hidden disabled={busy} onChange={post} /></label>
            <button type="button" className="ghost" disabled={busy || !note.trim()} onClick={() => post(null)}>Post note</button>
            {p.state === "funded" && <button type="button" onClick={() => rpc("admin_advance_project", { p_project: p.id, p_status: "ordered" }, "Marked ordered.")}>Mark ordered</button>}
            {p.state === "ordered" && <button type="button" onClick={() => rpc("admin_advance_project", { p_project: p.id, p_status: "delivered" }, "Marked delivered.")}>Mark delivered</button>}
            {(p.state === "open" || p.state === "missed") && <button type="button" className="ghost" onClick={() => rpc("admin_advance_project", { p_project: p.id, p_status: "cancelled" }, "Cancelled.")}>Cancel</button>}
          </div>
          <p className="small muted" style={{ margin: 0 }}>Posts are permanent. Ordering needs every pledge paid, and delivered needs a delivery photo.</p>
        </div>
      )}
    </div>
  );
}
