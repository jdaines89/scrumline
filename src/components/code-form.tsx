"use client";

import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";

// A code can come from an invite or from signing in to an existing account;
// Supabase checks each kind separately, so try them in turn.
const KINDS = ["email", "invite", "magiclink"] as const;

/** Type the code from the email, right here: no links. A newcomer chooses a password next. */
export function CodeForm({ email, onBack, resend }: { email: string; onBack: () => void; resend: () => Promise<void> }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const token = code.replace(/\D/g, "");
    if (token.length < 6 || token.length > 10) { setMsg("Type the whole code from the email."); return; }
    setBusy(true); setMsg(null);
    for (const type of KINDS) {
      const { error } = await supabase.auth.verifyOtp({ email, token, type });
      if (!error) return; // signed in: the app takes over from here
    }
    setBusy(false);
    setMsg("That code didn't work. Check the latest email, or send a new code.");
  }

  return (
    <>
      <h2>Check your email</h2>
      <p className="sub">We sent a code to <strong>{email}</strong>. Type it here. If it isn&apos;t there in a minute, check spam.</p>
      <form onSubmit={submit} className="stack">
        <input className="code-input" required autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={12}
          placeholder="Code from the email" value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))} />
        <button type="submit" disabled={busy}>{busy ? "Checking…" : "Continue"}</button>
      </form>
      {msg && <p className="small" style={{ color: "var(--danger)", marginBottom: 0 }}>{msg}</p>}
      <div className="code-foot small">
        <button type="button" className="linkish" disabled={resent} onClick={async () => { await resend(); setResent(true); }}>{resent ? "New code sent" : "Send a new code"}</button>
        <button type="button" className="linkish" onClick={onBack}>Use a different email</button>
      </div>
    </>
  );
}
