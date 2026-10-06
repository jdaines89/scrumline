"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Crest } from "@/components/crest";
import { useLeague } from "@/components/league";
import { SchoolSearch } from "@/components/school-search";
import { LANGUAGES, ROLES } from "@/lib/school";
import { money } from "@/lib/sponsor";
import { supabase } from "@/lib/supabase";
import type { School } from "@/lib/types";

interface Owed { emis: string; school: string; town: string | null; district: string | null; province: string | null; no_fee: boolean;
  owed_minor: number; since: string; players: number; introduced_by: string | null }
interface Check { check_name: string; ok: boolean; problems: number; detail: string }
interface Task {
  kind: "review" | "deliver" | "confirm"; id: number; emis: string; school: string; town: string | null; no_fee: boolean;
  detail: string | null; contact: string | null; phone: string | null; language: string | null; amount_minor: number | null; at: string;
}

const LANG = Object.fromEntries(LANGUAGES);

/** The schools work that needs a person: the money checks, claims to look at, and schools we look after by hand. */
export default function AdminSchools() {
  const { me } = useLeague();
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [owed, setOwed] = useState<Owed[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const [c, t, o] = await Promise.all([supabase.rpc("admin_money_checks"), supabase.rpc("admin_school_queue"), supabase.rpc("admin_unclaimed_owed")]);
    setChecks((c.data ?? []) as Check[]);
    setTasks((t.data ?? []) as Task[]);
    setOwed((o.data ?? []) as Owed[]);
  }, []);
  useEffect(() => { if (me.is_admin) load(); }, [me.is_admin, load]);

  if (!me.is_admin) return <div className="card narrow"><h2>Admins only</h2></div>;

  async function run(p: PromiseLike<{ error: { message: string } | null }>, done: string) {
    const { error } = await p;
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: done });
    load();
  }

  return (
    <>
      <div className="card narrow">
        <p className="sp-kicker">Admin</p>
        <h2>Money checks</h2>
        {checks === null ? <div className="skeleton" style={{ height: 120 }} /> : checks.map((c) => (
          <div key={c.check_name} className="rowline">
            <span>{c.check_name}<small className="muted block">{c.ok ? c.detail : `${c.problems} to look into · ${c.detail}`}</small></span>
            <b className={c.ok ? "pos" : "neg"}>{c.ok ? "OK" : "Look"}</b>
          </div>
        ))}
      </div>

      <div className="card narrow">
        <h2>Waiting on a person</h2>
        {msg && <p className="small" style={{ color: msg.ok ? "var(--accent)" : "var(--danger)" }}>{msg.text}</p>}
        {tasks === null && <div className="skeleton" style={{ height: 80 }} />}
        {tasks?.length === 0 && <p className="sub" style={{ marginBottom: 0 }}>Nothing. Every claim is sorted and every payment is confirmed.</p>}
        {tasks?.map((t) => <TaskRow key={`${t.kind}${t.id}`} t={t} run={run} />)}
      </div>

      <div className="card narrow">
        <h2>Owed, with nobody to pay yet</h2>
        <p className="sub">Schools sponsors have given money to that nobody has claimed, biggest first. After 12 months a school&apos;s share moves to its partner no-fee school.</p>
        {owed === null && <div className="skeleton" style={{ height: 80 }} />}
        {owed?.length === 0 && <p className="small muted" style={{ marginBottom: 0 }}>None. Every school that is owed money has someone to pay.</p>}
        {owed?.map((o) => (
          <div key={o.emis} className="task">
            <div className="task-head"><strong>{o.school}</strong><b>{money(o.owed_minor)}</b></div>
            <div className="small muted">{[o.town, o.district, o.province].filter(Boolean).join(", ")}{o.no_fee ? " · no-fee" : ""} · owed since {new Date(o.since).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}</div>
            <div className="small">{o.introduced_by ? `Partner of ${o.introduced_by}` : o.players ? `${o.players} player${o.players === 1 ? "" : "s"} went here and can help` : "No contact yet"}</div>
          </div>
        ))}
      </div>

      <CrestFinds />

      <LookAfter onDone={(text) => { setMsg({ ok: true, text }); load(); }} />
    </>
  );
}

interface Find { emis: string; school: string; town: string | null; province: string | null; image_path: string; source_url: string; claimed: boolean }

/** Crests we found that are waiting for each school's yes. A wrong match can be set aside before any school sees it. */
function CrestFinds() {
  const [finds, setFinds] = useState<Find[] | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase.rpc("admin_crest_finds");
    setFinds((data ?? []) as Find[]);
  }, []);
  useEffect(() => { load(); }, [load]);
  async function setAside(emis: string) {
    const { error } = await supabase.rpc("decide_crest_find", { p_emis: emis, p_use: false });
    if (!error) setFinds((f) => f?.filter((x) => x.emis !== emis) ?? null);
  }
  if (finds?.length === 0) return null;
  return (
    <div className="card narrow">
      <h2>Crests waiting for a school&apos;s yes</h2>
      <p className="sub">Found on each school&apos;s Wikipedia page. Players never see them. Someone verified from the school is asked &quot;Is this your crest?&quot; and only their yes puts it up. Set aside any that are wrong.</p>
      {finds === null && <div className="skeleton" style={{ height: 80 }} />}
      {finds?.map((f) => (
        <div key={f.emis} className="crest-row">
          <Crest emis={f.emis} path={f.image_path} size={44} name={f.school} />
          <div className="crest-row-text">
            <strong>{f.school}</strong>
            <span className="small muted">{[f.town, f.province].filter(Boolean).join(", ")} · <a href={f.source_url} target="_blank" rel="noreferrer">source</a>{f.claimed ? " · school can answer now" : ""}</span>
          </div>
          <button type="button" className="ghost" onClick={() => setAside(f.emis)}>Set aside</button>
        </div>
      ))}
    </div>
  );
}

function TaskRow({ t, run }: { t: Task; run: (p: PromiseLike<{ error: { message: string } | null }>, done: string) => void }) {
  const [note, setNote] = useState("");
  const who = [t.contact, t.phone, t.language ? LANG[t.language] : null].filter(Boolean).join(" · ");
  return (
    <div className="task">
      <div className="task-head">
        <strong>{t.school}</strong>
        <span className="small muted">{t.town}{t.no_fee ? " · no-fee" : ""}{t.amount_minor ? ` · ${money(t.amount_minor)}` : ""}</span>
      </div>
      <div className="small">{t.kind === "review" ? `Claim to check: ${t.detail}` : t.kind === "deliver" ? "Buy and deliver the goods the school asked for" : `Delivered: ${t.detail}`}</div>
      {who && <div className="small muted">{who}</div>}
      {t.kind === "review" ? (
        <div className="row">
          <button type="button" onClick={() => run(supabase.rpc("review_school_claim", { p_claim: t.id, p_approve: true, p_note: note || null }), `${t.school} approved.`)}>Approve</button>
          <button type="button" className="ghost" onClick={() => run(supabase.rpc("review_school_claim", { p_claim: t.id, p_approve: false, p_note: note || "Not the school's account" }), `${t.school} turned down.`)}>Turn down</button>
          <input placeholder="Why (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      ) : (
        <div className="row">
          <input placeholder={t.kind === "deliver" ? "What was delivered, and when" : "How the school confirmed (WhatsApp photo...)"} value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="button" disabled={note.trim().length < 3}
            onClick={() => run(t.kind === "deliver"
              ? supabase.rpc("record_goods_delivered", { p_payout: t.id, p_note: note })
              : supabase.rpc("confirm_assisted_payout", { p_payout: t.id, p_how: note }), "Saved.")}>
            {t.kind === "deliver" ? "Delivered" : "Confirmed"}
          </button>
        </div>
      )}
    </div>
  );
}

function LookAfter({ onDone }: { onDone: (text: string) => void }) {
  const [school, setSchool] = useState<School | null>(null);
  const [contact, setContact] = useState("");
  const [role, setRole] = useState("principal");
  const [phone, setPhone] = useState("");
  const [language, setLanguage] = useState("xh");
  const [mode, setMode] = useState<"goods" | "transfer">("goods");
  const [bank, setBank] = useState("");
  const [banks, setBanks] = useState<{ name: string; code: string }[] | null | false>(null);
  const [number, setNumber] = useState("");
  const [holder, setHolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "transfer" || banks !== null) return;
    supabase.functions.invoke("school-bank", { body: { action: "banks" } })
      .then(({ data, error }) => setBanks(error || !data?.banks ? false : data.banks));
  }, [mode, banks]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!school) return;
    const bankName = (banks || []).find((b) => b.code === bank)?.name ?? "";
    setBusy(true); setMsg(null);
    let error: string | null = null;
    if (mode === "goods") {
      const r = await supabase.rpc("assisted_goods_claim", { p_emis: school.emis, p_contact: contact, p_role: role, p_phone: phone, p_language: language });
      error = r.error?.message ?? null;
    } else {
      const r = await supabase.functions.invoke("school-bank", { body: {
        action: "claim", bank_code: bank, bank_name: bankName, account_number: number, account_name: holder,
        assisted: { emis: school.emis, contact, role, phone, language },
      } });
      if (r.error) error = (await (r.error as { context?: Response }).context?.json?.().catch(() => null))?.error ?? "Couldn't save it.";
    }
    setBusy(false);
    if (error) { setMsg(error); return; }
    onDone(`${school.name} is looked after by ${contact}. It goes on a week's notice first.`);
    setSchool(null); setContact(""); setPhone(""); setNumber(""); setHolder("");
  }

  return (
    <form className="card narrow lookafter" onSubmit={submit}>
      <h2>Look after a school</h2>
      <p className="sub">For a school that won&apos;t claim itself online: you&apos;ve spoken to it by phone or WhatsApp, and it takes its money by EFT or as goods.</p>
      {school ? (
        <div className="school-saved">
          <div><div className="school-name">{school.name}</div><div className="small muted">{school.town}{school.no_fee ? " · no-fee" : ""}</div></div>
          <button type="button" className="ghost" onClick={() => setSchool(null)}>Other school</button>
        </div>
      ) : <SchoolSearch onPick={(s) => { setSchool(s); setHolder(s.name); }} placeholder="Find the school" />}
      {school && (
        <div className="stack" style={{ marginTop: 10 }}>
          <input required minLength={2} maxLength={60} placeholder="Contact's name" value={contact} onChange={(e) => setContact(e.target.value)} />
          <div className="row">
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              {[...ROLES, ["teacher", "Teacher"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <input required inputMode="tel" pattern="\+?[0-9 ]{9,16}" placeholder="Phone or WhatsApp, like +27 82 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <div className="seg">
            <button type="button" className={mode === "goods" ? "on" : ""} onClick={() => setMode("goods")}>Goods</button>
            <button type="button" className={mode === "transfer" ? "on" : ""} onClick={() => setMode("transfer")}>EFT</button>
          </div>
          {mode === "transfer" && <>
            {banks === false && <p className="notice small" style={{ margin: 0 }}>EFT opens when payments switch on. Record the school for goods for now.</p>}
            <select required value={bank} onChange={(e) => setBank(e.target.value)} disabled={!banks}>
              <option value="" disabled>{banks === null ? "Loading banks…" : "Bank"}</option>
              {(banks || []).map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
            </select>
            <input required inputMode="numeric" placeholder="Account number" value={number} onChange={(e) => setNumber(e.target.value)} />
            <input required placeholder="Name on the account" value={holder} onChange={(e) => setHolder(e.target.value)} />
          </>}
          <button type="submit" disabled={busy || (mode === "transfer" && !banks)}>{busy ? "Saving…" : "Save"}</button>
          {msg && <p className="small" style={{ color: "var(--danger)", margin: 0 }}>{msg}</p>}
        </div>
      )}
    </form>
  );
}
