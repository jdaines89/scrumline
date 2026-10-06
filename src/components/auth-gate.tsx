"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { HowItWorks } from "@/components/how-it-works";
import { usePathname } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { CodeForm } from "@/components/code-form";
import { Join } from "@/components/join";
import { isBusinessSession, isPublicPath, isSchoolSession } from "@/lib/account";
import { clearCache } from "@/lib/cache";
import { arrivedVia, configured, supabase } from "@/lib/supabase";

/**
 * Nothing renders for anyone who isn't signed in. Players only get an account
 * from an invite email; businesses sign up at /business/ and schools at /schools/. Either link lands
 * here with a one-time session so the new account can choose a password.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [mustSetPassword, setMustSetPassword] = useState(arrivedVia === "invite" || arrivedVia === "recovery");
  // Every player has a password. Joining by email code doesn't set one, so ask once they're in.
  const uid = session?.user.id;
  const [hasPassword, setHasPassword] = useState<boolean | undefined>(undefined);
  const onJoin = (path ?? "").startsWith("/join");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "SIGNED_OUT") clearCache();
      if (event === "PASSWORD_RECOVERY") setMustSetPassword(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!uid) { setHasPassword(undefined); return; }
    if (passwordKnown(uid)) { setHasPassword(true); return; }
    setHasPassword(undefined);
    supabase.rpc("i_have_password").then(({ data, error }) => {
      // If the check can't run, never lock anyone out of the app over it.
      const yes = error ? true : data !== false;
      if (yes && !error) rememberPassword(uid);
      setHasPassword(yes);
    });
  }, [uid]);

  if (!configured) {
    return <div className="card"><h2>Not connected yet</h2>
      <p className="sub">Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_KEY to point the app at the league.</p></div>;
  }
  if (isPublicPath(path)) return <>{children}</>;
  if (session === undefined) return <p className="muted">Loading&hellip;</p>;
  if (!session) return onJoin ? <Join /> : <SignIn />;
  if (mustSetPassword || hasPassword === false) {
    return <SetPassword email={session.user.email ?? ""} reset={arrivedVia === "recovery"} business={isBusinessSession(session) || isSchoolSession(session)}
      onDone={() => { rememberPassword(session.user.id); setHasPassword(true); setMustSetPassword(false); }} />;
  }
  if (hasPassword === undefined) return <p className="muted">Loading&hellip;</p>;
  return <>{children}</>;
}

const PW_KEY = "scrumline:has-password:";
function passwordKnown(uid: string): boolean {
  try { return localStorage.getItem(PW_KEY + uid) === "1"; } catch { return false; }
}
function rememberPassword(uid: string): void {
  try { localStorage.setItem(PW_KEY + uid, "1"); } catch { /* storage blocked: we just ask the server next time */ }
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [byCode, setByCode] = useState(false);
  const [codeSent, setCodeSent] = useState(false);

  async function sendCode() {
    const { data, error } = await supabase.functions.invoke("join", { body: { email, mode: "signin" } });
    if (error) {
      let text = "We couldn't send a code. Try again in a minute.";
      try { text = (await (error as { context?: Response }).context?.json())?.error ?? text; } catch { /* keep the default */ }
      setMsg(text);
      return false;
    }
    return (data as { status?: string })?.status === "code";
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    if (byCode) {
      const ok = await sendCode();
      setBusy(false);
      if (ok) setCodeSent(true);
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setMsg("That email and password don't match an account.");
  }

  async function forgot() {
    if (!email) { setMsg("Type your email above first, then tap Forgot your password."); return; }
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + (process.env.NEXT_PUBLIC_BASE_PATH || "") + "/" });
    setMsg("If that email has an account, a reset link is on its way. Check spam if it doesn't show up in a minute.");
  }

  if (codeSent) {
    return (
      <div className="card narrow">
        <CodeForm email={email} onBack={() => { setCodeSent(false); setMsg(null); }} resend={async () => { await sendCode(); }} />
      </div>
    );
  }

  return (
    <>
    <div className="card narrow">
      <h2>Sign in</h2>
      <p className="sub">Use the email you joined with.</p>
      <form onSubmit={submit} className="stack">
        <input type="email" required placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        {!byCode && <input type="password" required placeholder="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        <button type="submit" disabled={busy}>{busy ? (byCode ? "Sending…" : "Signing in…") : byCode ? "Email me a code" : "Sign in"}</button>
        <button type="button" className="linkish forgot" onClick={() => { setByCode(!byCode); setMsg(null); }}>{byCode ? "Use my password instead" : "No password? Email me a code"}</button>
        {!byCode && <button type="button" className="linkish forgot" onClick={forgot}>Forgot your password?</button>}
      </form>
      {msg && <p className="small muted" style={{ marginBottom: 0 }}>{msg}</p>}
      <p className="small muted signin-biz">Own a business? <Link href="/business/">Sponsor a school</Link>
        <br />Run a school? <Link href="/schools/">Claim it</Link></p>
    </div>
    <HowItWorks />
    </>
  );
}

function SetPassword({ email, reset, business, onDone }: { email: string; reset: boolean; business: boolean; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  // Names are asked once inside the app ("Who's playing?"), for new and old players alike.
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setMsg("Use at least 8 characters."); return; }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { setMsg(error.message); return; }
    onDone();
  }

  return (
    <div className="card narrow">
      <h2>{reset ? "Choose a new password" : business ? "Welcome to Scrumline" : "Welcome to the league"}</h2>
      <p className="sub">{reset ? `For ${email}.` : `Choose a password for ${email}. You'll use it to sign in from now on.`}</p>
      <form onSubmit={submit} className="stack">
        <input type="password" required placeholder="New password (8+ characters)" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button type="submit">Save and continue</button>
      </form>
      {msg && <p className="small" style={{ color: "var(--danger)", marginBottom: 0 }}>{msg}</p>}
    </div>
  );
}
