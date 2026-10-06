"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CodeForm } from "@/components/code-form";
import { HowItWorks } from "@/components/how-it-works";
import { InviteCalls } from "@/components/invite-calls";
import { readJoinLink } from "@/lib/join-link";
import { supabase } from "@/lib/supabase";

type Info = { inviter: string; open: boolean } | null;
type League = { pool_name: string; season_name: string; players: number };

/** The page a personal invite link opens, for someone without an account yet. */
export function Join() {
  const [code, setCode] = useState("");
  const [pool, setPool] = useState("");
  const [league, setLeague] = useState<League | null>(null);
  const [info, setInfo] = useState<Info | undefined>(undefined);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"code" | "sent" | "exists" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [calls, setCalls] = useState(0);

  useEffect(() => {
    const { invite: c, league: p } = readJoinLink(window.location.search);
    setCode(c);
    setPool(p);
    if (p) supabase.rpc("pool_invite_info", { p_code: p }).then(({ data }) => setLeague(((data ?? []) as League[])[0] ?? null));
    if (!c) { setInfo(null); return; }
    supabase.rpc("invite_info", { p_code: c }).then(({ data }) => setInfo(((data ?? []) as Info[])[0] ?? null));
  }, []);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.functions.invoke("join", { body: { code, email, pool: league ? pool : null } });
    setBusy(false);
    if (error) {
      let text = "We couldn't send the invite. Try again in a minute.";
      try { text = (await (error as { context?: Response }).context?.json())?.error ?? text; } catch { /* keep the default */ }
      setMsg(text);
      return;
    }
    setDone((data as { status: "code" | "sent" | "exists" }).status);
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
  if (done === "code") {
    return (
      <div className="card narrow join">
        {league && <p className="kicker">Joining {league.pool_name}</p>}
        <CodeForm email={email} onBack={() => { setDone(null); setMsg(null); }} resend={() => submit()} />
      </div>
    );
  }
  if (done === "sent") {
    return (
      <div className="card narrow">
        <h2>Check your email</h2>
        <p className="sub">We&apos;ve sent an invite to {email}. Tap the link in it to set your password and you&apos;re in{league ? <>, already in <strong>{league.pool_name}</strong></> : null}. If it isn&apos;t there in a minute, check spam.</p>
        {calls > 0 && <p className="small muted" style={{ marginBottom: 0 }}>Open the link on this phone and your {calls === 1 ? "call comes" : "calls come"} with you.</p>}
      </div>
    );
  }
  if (done === "exists") {
    return (
      <div className="card narrow">
        <h2>You&apos;re already on the list</h2>
        <p className="sub">That email already has an account or an invite waiting. Look for the invite email, or sign in{league ? " and open this link again to join the league" : ""}. Forgot your password works there too.</p>
        <a className="btn" href={home}>Sign in</a>
      </div>
    );
  }
  return (
    <>
    <div className="card narrow join">
      {league ? (
        <>
          <p className="kicker">{league.season_name}</p>
          <h2>{info.inviter} wants you in {league.pool_name}</h2>
          <p className="sub">
            A rugby prediction league{league.players > 1 ? ` with ${league.players} players already in` : ""}. Call the scores, climb the table and win
            prizes from local businesses, while every game you play helps fund South African schools.
          </p>
        </>
      ) : (
        <>
          <h2>{info.inviter} invited you to Scrumline</h2>
          <p className="sub">Rugby prediction leagues with your friends, your class and your school. Win prizes from local businesses and help fund South African schools.</p>
        </>
      )}
      <form onSubmit={submit} className="stack">
        <input type="email" required placeholder="Your email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button type="submit" disabled={busy}>{busy ? "Sending…" : calls ? `Join and save my ${calls === 1 ? "call" : `${calls} calls`}` : league ? "Join the league" : "Send my invite"}</button>
      </form>
      {msg && <p className="small" style={{ color: "var(--danger)", marginBottom: 0 }}>{msg}</p>}
      <InviteCalls league={league ? pool : ""} onCount={setCalls} />
      <p className="small muted join-foot">Already on Scrumline? <a href={home}>Sign in</a></p>
    </div>
    <HowItWorks />
    </>
  );
}
