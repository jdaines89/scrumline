"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useLeague } from "@/components/league";
import { supabase } from "@/lib/supabase";

interface Row {
  id: number; season: string; title: string; sponsor_name: string | null; achievement_key: string; terms: string | null;
  starts_at: string | null; ends_at: string | null; active: boolean; total: number; claimed: number; remaining: number;
}

const KEYS: [string, string][] = [
  ["sharpshooter", "Sharpshooter"], ["clean-sweep", "Clean sweep"], ["banker-bang", "Banker bang"], ["dead-on", "Dead-on"],
];

/** Sponsor rewards: make a campaign for a badge, paste the voucher codes the sponsor gave us, switch it on. Counts only. */
export default function AdminRewards() {
  const { me, seasons, season } = useLeague();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState({ season: season.id, key: "sharpshooter", title: "", sponsor: "", terms: "" });
  const [codes, setCodes] = useState<Record<number, string>>({});
  const load = useCallback(() => { supabase.rpc("admin_rewards").then(({ data }) => setRows((data ?? []) as Row[])); }, []);
  useEffect(load, [load]);
  if (!me.is_admin) return <div className="card narrow"><h2>Admins only</h2></div>;
  const say = (ok: boolean, text: string) => setMsg({ ok, text });

  async function create(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc("admin_save_reward", {
      p_id: null, p_season: form.season, p_title: form.title, p_sponsor: form.sponsor, p_key: form.key,
      p_terms: form.terms, p_starts: null, p_ends: null, p_active: false,
    });
    if (error) return say(false, error.message);
    setForm({ ...form, title: "", sponsor: "", terms: "" });
    say(true, "Campaign made. Add codes, then switch it on.");
    load();
  }
  async function toggle(r: Row) {
    const { error } = await supabase.rpc("admin_save_reward", {
      p_id: r.id, p_season: r.season, p_title: r.title, p_sponsor: r.sponsor_name, p_key: r.achievement_key,
      p_terms: r.terms, p_starts: r.starts_at, p_ends: r.ends_at, p_active: !r.active,
    });
    say(!error, error ? error.message : r.active ? "Switched off. Players no longer see it." : "Switched on. Players can see it now.");
    load();
  }
  async function addCodes(r: Row) {
    const { data, error } = await supabase.rpc("admin_add_reward_codes", { p_campaign: r.id, p_codes: codes[r.id] ?? "" });
    if (error) return say(false, error.message);
    setCodes({ ...codes, [r.id]: "" });
    say(true, `${data as number} code${data === 1 ? "" : "s"} added.`);
    load();
  }

  return (
    <>
      <div className="card narrow">
        <p className="sp-kicker">Admin</p>
        <h2>Sponsor rewards</h2>
        <p className="sub">A badge can unlock a voucher a sponsor gave us. Players see nothing until a campaign is switched on. You see counts only, never who claimed.</p>
        {msg && <p className="small" style={{ color: msg.ok ? "var(--accent)" : "var(--danger)" }}>{msg.text}</p>}
        <form onSubmit={create} className="adm-form">
          <label>Tournament
            <select value={form.season} onChange={(e) => setForm({ ...form, season: e.target.value })}>
              {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>Badge
            <select value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })}>
              {KEYS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
          </label>
          <label>What players get<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. R100 off at the shop" required minLength={3} maxLength={80} /></label>
          <label>Sponsor name (only once they have agreed)<input value={form.sponsor} onChange={(e) => setForm({ ...form, sponsor: e.target.value })} maxLength={60} /></label>
          <label>Terms (short)<input value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} maxLength={600} placeholder="e.g. Spend R200 or more. Valid until 31 Jan." /></label>
          <button className="btn">Make campaign</button>
        </form>
      </div>
      {(rows ?? []).map((r) => (
        <div key={r.id} className="card narrow adm-card">
          <h3 style={{ marginTop: 0 }}>{r.title}</h3>
          <p className="small muted">
            {KEYS.find(([k]) => k === r.achievement_key)?.[1]} · {seasons.find((s) => s.id === r.season)?.name ?? r.season}
            {r.sponsor_name ? ` · ${r.sponsor_name}` : ""} · {r.active ? "Live" : "Off"}
          </p>
          <p className="small">{r.total} codes · {r.claimed} claimed · {r.remaining} left</p>
          <label>Paste codes, one per line
            <textarea rows={3} value={codes[r.id] ?? ""} onChange={(e) => setCodes({ ...codes, [r.id]: e.target.value })} />
          </label>
          <div className="row" style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" className="ghost" onClick={() => addCodes(r)} disabled={!(codes[r.id] ?? "").trim()}>Add codes</button>
            <button type="button" className={r.active ? "ghost" : "btn"} onClick={() => toggle(r)} disabled={!r.active && r.remaining === 0}>{r.active ? "Switch off" : "Switch on"}</button>
          </div>
        </div>
      ))}
    </>
  );
}
