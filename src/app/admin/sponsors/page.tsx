"use client";

import { useCallback, useEffect, useState } from "react";
import { useLeague } from "@/components/league";
import { randsToMinor } from "@/lib/projects";
import { money } from "@/lib/sponsor";
import { supabase } from "@/lib/supabase";

interface Row {
  id: number; season_id: string; season_name: string; round: number | null; sponsor: string; category: string; email: string;
  amount_minor: number; reserve_minor: number; currency: string; offer: string | null; link: string | null; note: string | null;
  status: string; reply: string | null; pay_by: string | null; created_at: string; rivals: number;
}

const day = (d: string) => new Date(d).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
const slotName = (r: number | null) => (r === null ? "Whole tournament" : `Round ${r}`);

/** Tournament and round sponsors: approve one per slot, mark it paid to put it live. */
export default function AdminSponsors() {
  const { me, seasons } = useLeague();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => {
    supabase.rpc("admin_tournament_sponsors").then(({ data }) => setRows((data ?? []) as Row[]));
  }, []);
  useEffect(load, [load]);
  if (!me.is_admin) return <div className="card narrow"><h2>Admins only</h2></div>;

  async function decide(r: Row, decision: "approve" | "decline" | "paid" | "lapse", reply?: string) {
    const { error } = await supabase.rpc("admin_decide_tournament_sponsor", { p_id: r.id, p_decision: decision, p_reply: reply ?? null });
    const done = { approve: `${r.sponsor} approved. Send them payment details.`, decline: `${r.sponsor} declined.`, paid: `${r.sponsor} is live.`, lapse: "The slot is free again." }[decision];
    setMsg({ ok: !error, text: error ? error.message : done });
    load();
  }

  const open = rows?.filter((r) => r.status === "applied" || r.status === "approved") ?? [];
  const past = rows?.filter((r) => !open.includes(r)) ?? [];

  return (
    <>
      <div className="card narrow">
        <p className="sp-kicker">Admin</p>
        <h2>Tournament sponsors</h2>
        <p className="sub">Approve one business per slot. It then has 7 days to pay (or until the round starts). Mark it paid when the money is in, and it goes live for every player in the tournament.</p>
        {msg && <p className="small" style={{ color: msg.ok ? "var(--accent)" : "var(--danger)" }}>{msg.text}</p>}
        {rows === null && <div className="skeleton" style={{ height: 80 }} />}
        {rows !== null && open.length === 0 && <p className="small muted" style={{ margin: 0 }}>Nothing waiting.</p>}
        {open.map((r) => <Application key={r.id} r={r} decide={decide} />)}
      </div>
      <Reserves seasons={seasons.filter((s) => !s.is_replay)} />
      {past.length > 0 && (
        <div className="card narrow">
          <h3>History</h3>
          {past.map((r) => (
            <div key={r.id} className="rowline">
              <span>{r.sponsor} · {r.season_name} · {slotName(r.round)}<small className="muted block">{money(r.amount_minor, r.currency)} · {r.status}{r.reply ? ` · ${r.reply}` : ""}</small></span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Application({ r, decide }: { r: Row; decide: (r: Row, d: "approve" | "decline" | "paid" | "lapse", reply?: string) => void }) {
  const [reply, setReply] = useState("");
  return (
    <div className="opt" style={{ display: "block" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>{r.sponsor}</strong>
        <span className="price">{money(r.amount_minor, r.currency)}</span>
      </div>
      <div className="small muted">
        {r.season_name} · {slotName(r.round)} · reserve {money(r.reserve_minor, r.currency)} · {r.category.replace("_", " ")} · {r.email}
        {r.rivals > 0 && ` · ${r.rivals} other offer${r.rivals === 1 ? "" : "s"} for this slot`}
      </div>
      {r.offer && <div className="small">Line: {r.offer}{r.link ? ` (${r.link})` : ""}</div>}
      {r.note && <div className="small muted">Note: {r.note}</div>}
      {r.status === "approved" && <div className="small">Approved. Pay by {r.pay_by ? day(r.pay_by) : "soon"}.</div>}
      <div className="row" style={{ marginTop: 8 }}>
        <input className="grow" maxLength={280} placeholder="Message to the business (optional)" value={reply} onChange={(e) => setReply(e.target.value)} />
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        {r.status === "applied" && <button type="button" onClick={() => decide(r, "approve", reply)}>Approve</button>}
        {r.status === "applied" && <button type="button" className="ghost" onClick={() => decide(r, "decline", reply)}>Decline</button>}
        {r.status === "approved" && <button type="button" onClick={() => decide(r, "paid")}>Mark paid, go live</button>}
        {r.status === "approved" && <button type="button" className="ghost" onClick={() => decide(r, "lapse", reply)}>Not paid</button>}
      </div>
    </div>
  );
}

function Reserves({ seasons }: { seasons: { id: string; name: string }[] }) {
  const [season, setSeason] = useState(seasons[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [round, setRound] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!season) return;
    supabase.rpc("tournament_slots", { p_season: season }).then(({ data }) => {
      const ss = (data ?? []) as { round: number | null; reserve_minor: number }[];
      const t = ss.find((s) => s.round === null); const r = ss.find((s) => s.round !== null);
      if (t) setTitle(String(t.reserve_minor / 100));
      if (r) setRound(String(r.reserve_minor / 100));
    });
  }, [season]);
  async function save() {
    const t = randsToMinor(title); const r = randsToMinor(round);
    if (!t || !r) { setMsg("Type both amounts in rands."); return; }
    const { error } = await supabase.rpc("admin_set_tournament_reserve", { p_season: season, p_title_minor: t, p_round_minor: r });
    setMsg(error ? (error.message.includes("check") ? "The tournament minimum is at least R1,000 and a round at least R100." : error.message) : "Saved.");
  }
  if (!seasons.length) return null;
  return (
    <div className="card narrow stack">
      <h3>Reserves</h3>
      <p className="small muted" style={{ margin: 0 }}>The least a business can offer. Offers below it can&apos;t be sent.</p>
      <select value={season} onChange={(e) => setSeason(e.target.value)} aria-label="Tournament">{seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <div className="row">
        <label className="proj-amt"><span>Tournament R</span><input inputMode="decimal" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="proj-amt"><span>Round R</span><input inputMode="decimal" value={round} onChange={(e) => setRound(e.target.value)} /></label>
      </div>
      <div className="row"><button type="button" onClick={save}>Save reserves</button>{msg && <span className="small muted">{msg}</span>}</div>
    </div>
  );
}
