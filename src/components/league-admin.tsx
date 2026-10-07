"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Member, Pool } from "@/lib/types";

/** Whoever started a league, or an admin, runs it: removes players and changes its code. School leagues run themselves. */
export function runsLeague(pool: Pool, me: Member): boolean {
  return !pool.school_emis && (pool.created_by === me.user_id || me.is_admin);
}

/**
 * "Remove from league" under a player's row, with a plain confirm first.
 * They leave every tournament's table and the chat; their calls stay.
 */
export function RemovePlayer({ pool, userId, name, onRemoved }: { pool: Pool; userId: string; name: string; onRemoved: () => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function remove() {
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("remove_league_member", { p_pool: pool.id, p_user: userId });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    setAsking(false); onRemoved();
  }

  if (!asking) {
    return (
      <button type="button" className="linkish brm-open" onClick={(e) => { e.stopPropagation(); setAsking(true); }}>
        Remove from league
      </button>
    );
  }
  return (
    <div className="brm" onClick={(e) => e.stopPropagation()}>
      <p className="small">
        Remove <strong>{name}</strong> from {pool.name}? They leave every tournament in the league and its chat, and can&apos;t join again
        unless you let them back in. Their calls and points stay theirs.
      </p>
      {msg && <div className="notice">{msg}</div>}
      <div className="brm-acts">
        <button type="button" className="danger" disabled={busy} onClick={remove}>{busy ? "Removing…" : "Remove"}</button>
        <button type="button" className="ghost" disabled={busy} onClick={() => setAsking(false)}>Cancel</button>
      </div>
    </div>
  );
}

interface Removed { user_id: string; display_name: string; removed_at: string }

/** Under the table, for whoever runs the league: who was removed, and a way to let them back in. Hidden when nobody was. */
export function RemovedPlayers({ pool, tick }: { pool: Pool; tick: number }) {
  const [rows, setRows] = useState<Removed[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    supabase.rpc("league_removed", { p_pool: pool.id }).then(({ data }) => setRows((data ?? []) as Removed[]));
  }, [pool.id, tick]);

  async function letBack(r: Removed) {
    setBusy(r.user_id);
    const { error } = await supabase.rpc("league_let_back", { p_pool: pool.id, p_user: r.user_id });
    setBusy(null);
    if (!error) setRows((rs) => rs.filter((x) => x.user_id !== r.user_id));
  }

  if (rows.length === 0) return null;
  return (
    <details className="board-break">
      <summary>Removed <span className="muted">· {rows.length}</span></summary>
      <p className="small muted">Players in the league don&apos;t see this list. Letting someone back in means they can join again with the league code or an invite link.</p>
      <ul className="inv-list">
        {rows.map((r) => (
          <li key={r.user_id}>
            <span className="inv-name">{r.display_name}</span>
            <button type="button" className="ghost" disabled={busy === r.user_id} onClick={() => letBack(r)}>
              {busy === r.user_id ? "Letting back…" : "Let back in"}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** "Change code" beside the league code: a new one for every tournament in the league, after a confirm. */
export function ChangeCode({ poolId, onChanged }: { poolId: number; onChanged: (code: string) => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function change() {
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc("new_league_code", { p_pool: poolId });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    setAsking(false); onChanged(data as string);
  }

  if (!asking) {
    return <button type="button" className="linkish small inv-code-change" onClick={() => setAsking(true)}>Change the code</button>;
  }
  return (
    <div className="inv-code-ask">
      <p className="small">
        Give the league a new code? The old code, and invite links that carry it, stop working. Everyone already in the league stays in.
      </p>
      {msg && <div className="notice">{msg}</div>}
      <div className="brm-acts">
        <button type="button" disabled={busy} onClick={change}>{busy ? "Changing…" : "New code"}</button>
        <button type="button" className="ghost" disabled={busy} onClick={() => setAsking(false)}>Keep this one</button>
      </div>
    </div>
  );
}
