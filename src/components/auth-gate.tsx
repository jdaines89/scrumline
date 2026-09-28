"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "SIGNED_OUT") clearCache();
      if (event === "PASSWORD_RECOVERY") setMustSetPassword(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (!configured) {
    return <div className="card"><h2>Not connected yet</h2>
      <p className="sub">Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_KEY to point the app at the league.</p></div>;
  }
  if (isPublicPath(path)) return <>{children}</>;
  if (session === undefined) return <p className="muted">Loading&hellip;</p>;
  if (!session) return <SignIn />;
  if (mustSetPassword) return <SetPassword email={session.user.email ?? ""} reset={arrivedVia === "recovery"} business={isBusinessSession(session) || isSchoolSession(session)} onDone={() => setMustSetPassword(false)} />;
  return <>{children}</>;
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setMsg("That email and password don't match an account.");
  }

  async function forgot() {
    if (!email) { setMsg("Type your email above first, then tap Forgot your password."); return; }
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + (process.env.NEXT_PUBLIC_BASE_PATH || "") + "/" });
    setMsg("If that email has an account, a reset link is on its way. Check spam if it doesn't show up in a minute.");
  }

  return (
    <div className="card narrow">
      <h2>Sign in</h2>
      <p className="sub">Use the email your invite or sign-up link went to.</p>
      <form onSubmit={submit} className="stack">
        <input type="email" required placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" required placeholder="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <button type="button" className="linkish forgot" onClick={forgot}>Forgot your password?</button>
      </form>
      {msg && <p className="small muted" style={{ marginBottom: 0 }}>{msg}</p>}
      <p className="small muted signin-biz">Own a business? <Link href="/business/">Sponsor a school</Link>
        <br />Run a school? <Link href="/schools/">Claim it</Link></p>
    </div>
  );
}

function SetPassword({ email, reset, business, onDone }: { email: string; reset: boolean; business: boolean; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setMsg("Use at least 8 characters."); return; }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { setMsg(error.message); return; }
    if (name.trim() && !business) {
      const { data } = await supabase.auth.getUser();
      if (data.user) await supabase.from("members").update({ display_name: name.trim() }).eq("user_id", data.user.id);
    }
    onDone();
  }

  return (
    <div className="card narrow">
      <h2>{reset ? "Choose a new password" : business ? "Welcome to Scrumline" : "Welcome to the league"}</h2>
      <p className="sub">{reset ? `For ${email}.` : `Choose a password for ${email}. You'll use it to sign in from now on.`}</p>
      <form onSubmit={submit} className="stack">
        {!reset && !business && <input placeholder="Your name, as the others will see it" value={name} onChange={(e) => setName(e.target.value)} />}
        <input type="password" required placeholder="New password (8+ characters)" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button type="submit">Save and continue</button>
      </form>
      {msg && <p className="small" style={{ color: "var(--danger)", marginBottom: 0 }}>{msg}</p>}
    </div>
  );
}
