"use client";

import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";

type Info = { inviter: string; open: boolean } | null;

/** The page a personal invite link opens, for someone without an account yet. */
export function Join() {
  const [code, setCode] = useState("");
  const [info, setInfo] = useState<Info | undefined>(undefined);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"sent" | "exists" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("c") ?? "";
    setCode(c);
    if (!c) { setInfo(null); return; }
    supabase.rpc("invite_info", { p_code: c }).then(({ data }) => setInfo(((data ?? []) as Info[])[0] ?? null));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.functions.invoke("join", { body: { code, email } });
    setBusy(false);
    if (error) {
      let text = "We couldn't send the invite. Try again in a minute.";
      try { text = (await (error as { context?: Response }).context?.json())?.error ?? text; } catch { /* keep the default */ }
      setMsg(text);
      return;
    }
    setDone((data as { status: "sent" | "exists" }).status);
  }

  const home = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`;
  if (info === undefined) return <p className="muted">Loading&hellip;</p>;
  if (!info || !info.open) {
    return (
      <div className="card narrow">
        <h2>This invite link has expired</h2>
        <p className="sub">{info ? `${info.inviter}'s link has been used as often as it can be.` : "It may have been reset."} Ask whoever sent it for a fresh one.</p>
        <a href={home}>Already on Scrumline? Sign in</a>
      </div>
    );
  }
  if (done === "sent") {
    return (
      <div className="card narrow">
        <h2>Check your email</h2>
        <p className="sub">We&apos;ve sent an invite to {email}. Tap the link in it to set your password and you&apos;re in. If it isn&apos;t there in a minute, check spam.</p>
      </div>
    );
  }
  if (done === "exists") {
    return (
      <div className="card narrow">
        <h2>You&apos;re already on the list</h2>
        <p className="sub">That email already has an account or an invite waiting. Look for the invite email, or sign in. Forgot your password works there too.</p>
        <a className="btn" href={home}>Sign in</a>
      </div>
    );
  }
  return (
    <div className="card narrow join">
      <h2>{info.inviter} invited you to Scrumline</h2>
      <p className="sub">Rugby prediction pools with your mates, your class and your school. Free to play, no betting.</p>
      <form onSubmit={submit} className="stack">
        <input type="email" required placeholder="Your email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button type="submit" disabled={busy}>{busy ? "Sending…" : "Send my invite"}</button>
      </form>
      {msg && <p className="small" style={{ color: "var(--danger)", marginBottom: 0 }}>{msg}</p>}
      <p className="small muted join-foot">Already on Scrumline? <a href={home}>Sign in</a></p>
    </div>
  );
}
