"use client";

import { useEffect, useState } from "react";
import { fullName } from "@/lib/names";
import { supabase } from "@/lib/supabase";
import type { Member } from "@/lib/types";

type Candidate = Pick<Member, "user_id" | "display_name" | "first_name" | "last_name" | "known_as"> & { invited: boolean; declined: boolean };
interface Waiting { pool_id: number; pool_name: string; season_name: string | null; inviter_name: string; players: number }

/**
 * Invite to one league: everyone you already play with in another league, one
 * tap each. Someone not on Scrumline yet still needs the link.
 */
export function InviteSheet({ poolId, poolName, joinCode, onClose, onSendLink }: {
  poolId: number; poolName: string; joinCode?: string | null; onClose: () => void; onSendLink: () => void;
}) {
  const [people, setPeople] = useState<Candidate[] | null>(null);
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    if (!joinCode) return;
    try { await navigator.clipboard.writeText(joinCode); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* no clipboard */ }
  }
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc("invite_candidates", { p_pool: poolId }).then(({ data }) => setPeople((data ?? []) as Candidate[]));
  }, [poolId]);

  async function invite(c: Candidate) {
    setBusy(c.user_id); setMsg(null);
    const { error } = await supabase.rpc("invite_to_pool", { p_pool: poolId, p_user: c.user_id });
    setBusy(null);
    if (error) { setMsg(error.message); return; }
    setPeople((ps) => ps?.map((p) => (p.user_id === c.user_id ? { ...p, invited: true } : p)) ?? null);
  }

  return (
    <div className="wip-dim" onClick={onClose}>
      <div className="wip-sheet" role="dialog" aria-label={`Invite to ${poolName}`} onClick={(e) => e.stopPropagation()}>
        <h2>Invite to {poolName}</h2>
        <p className="sub">People you already play with in your other leagues. They&apos;ll see it next time they open Scrumline.</p>
        {people === null ? <div className="skeleton" style={{ height: 120 }} /> : people.length === 0 ? (
          <p className="small muted">Everyone you play with is already in this league.</p>
        ) : (
          <ul className="inv-list">
            {people.map((c) => (
              <li key={c.user_id}>
                <span className="inv-name">{fullName(c)}</span>
                {c.declined ? <span className="small muted">Said not now</span>
                  : c.invited ? <span className="small inv-done">Invited</span>
                  : <button type="button" className="ghost" disabled={busy === c.user_id} onClick={() => invite(c)}>{busy === c.user_id ? "Inviting…" : "Invite"}</button>}
              </li>
            ))}
          </ul>
        )}
        {msg && <div className="notice" style={{ marginTop: 10 }}>{msg}</div>}
        <div className="inv-new">
          <span className="small muted">Someone not on Scrumline yet?</span>
          <button type="button" className="ghost" onClick={onSendLink}>Send them the link</button>
        </div>
        {joinCode && (
          <div className="inv-code">
            <div>
              <span className="small muted">League code</span>
              <strong className="inv-code-value">{joinCode}</strong>
              <span className="small muted">Anyone can join with it under Leagues, Join with a code.</span>
            </div>
            <button type="button" className="ghost" onClick={copyCode} aria-label={`Copy league code ${joinCode}`}>{copied ? "Copied" : "Copy"}</button>
          </div>
        )}
        <button type="button" className="wip-save" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

/** Invites waiting for you, at the top of Leagues: join with one tap or wave it off. */
export function WaitingInvites({ onJoined }: { onJoined: (poolId: number) => void }) {
  const [rows, setRows] = useState<Waiting[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  useEffect(() => {
    supabase.rpc("my_pool_invites").then(({ data }) => setRows((data ?? []) as Waiting[]));
  }, []);
  async function answer(w: Waiting, join: boolean) {
    setBusy(w.pool_id);
    const { error } = await supabase.rpc("answer_pool_invite", { p_pool: w.pool_id, p_join: join });
    setBusy(null);
    if (error) return;
    setRows((rs) => rs.filter((r) => r.pool_id !== w.pool_id));
    if (join) onJoined(w.pool_id);
  }
  if (rows.length === 0) return null;
  return (
    <div className="inv-waiting">
      {rows.map((w) => (
        <div key={w.pool_id} className="inv-card" role="status">
          <strong>{w.inviter_name} invited you to {w.pool_name}</strong>
          <span className="small muted">{[w.season_name, `${w.players} player${w.players === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</span>
          <div className="row">
            <button type="button" disabled={busy === w.pool_id} onClick={() => answer(w, true)}>{busy === w.pool_id ? "Joining…" : "Join"}</button>
            <button type="button" className="ghost" disabled={busy === w.pool_id} onClick={() => answer(w, false)}>Not now</button>
          </div>
        </div>
      ))}
    </div>
  );
}
