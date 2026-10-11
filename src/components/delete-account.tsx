"use client";

import { useState, type FormEvent } from "react";
import { signOut } from "@/lib/push";
import { supabase } from "@/lib/supabase";

/**
 * Profile's "Delete my account": a quiet link that opens a sheet, and the
 * player types DELETE to confirm. The database removes everything that names
 * them (see delete_my_account) and hands back their picture and chat photos,
 * which are removed here with their own storage rights before signing out.
 */
export function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc("delete_my_account", { p_confirm: typed.trim().toUpperCase() });
    if (error) { setBusy(false); setMsg(error.message.includes("fetch") ? "We couldn't reach Scrumline. Check your connection and try again." : error.message); return; }
    const byBucket = new Map<string, string[]>();
    for (const p of (data as string[] | null) ?? []) {
      const i = p.indexOf("/");
      byBucket.set(p.slice(0, i), [...(byBucket.get(p.slice(0, i)) ?? []), p.slice(i + 1)]);
    }
    for (const [bucket, paths] of byBucket) {
      try { await supabase.storage.from(bucket).remove(paths); } catch { /* the account is already gone; leftover files have no name on them */ }
    }
    try { localStorage.clear(); } catch { /* storage blocked */ }
    await signOut();
    window.location.replace((process.env.NEXT_PUBLIC_BASE_PATH || "") + "/");
  }

  return (
    <>
      <button type="button" className="linkish delete-account" onClick={() => { setTyped(""); setMsg(null); setOpen(true); }}>Delete my account</button>
      {open && (
        <div className="wip-dim" onClick={(e) => { if (e.target === e.currentTarget && !busy) setOpen(false); }}>
          <form className="wip-sheet stack" role="dialog" aria-label="Delete my account" onSubmit={submit}>
            <h2>Delete your account?</h2>
            <p className="sub" style={{ margin: 0 }}>
              Your name, email, picture, schools, chat messages and photos are removed, and you&apos;re signed out for good.
              Your calls stay in your leagues&apos; tables as &ldquo;Former player&rdquo;, with no name attached, so nobody else&apos;s points change.
              This can&apos;t be undone.
            </p>
            <label className="small muted">Type DELETE to confirm
              <input autoComplete="off" autoCapitalize="characters" value={typed} onChange={(e) => setTyped(e.target.value)} />
            </label>
            {msg && <p className="small" style={{ color: "var(--danger)", margin: 0 }}>{msg}</p>}
            <div className="wip-row">
              <button type="button" className="ghost" disabled={busy} onClick={() => setOpen(false)}>Keep my account</button>
              <button type="submit" className="danger" disabled={busy || typed.trim().toUpperCase() !== "DELETE"} style={{ flex: 1 }}>{busy ? "Deleting…" : "Delete"}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
