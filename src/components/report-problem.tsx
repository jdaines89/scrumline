"use client";

import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";

/** Opens the "Report a problem" sheet from anywhere, with the error that went wrong if there is one. */
export function reportProblem(error?: string) {
  window.dispatchEvent(new CustomEvent("scrumline:report", { detail: error }));
}

/** A plain link that opens the sheet. */
export function ReportLink({ label = "Report a problem", error }: { label?: string; error?: string }) {
  return <button type="button" className="linkish" onClick={() => reportProblem(error)}>{label}</button>;
}

let lastError: string | undefined;

/** Lives once in the layout, outside sign-in, so a player who can't get in can still tell us. */
export function ReportProblem() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [signedIn, setSignedIn] = useState(true);
  const [body, setBody] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const keep = (m: unknown) => { lastError = String(m).slice(0, 500); };
    const onError = (e: ErrorEvent) => keep(e.message);
    const onReject = (e: PromiseRejectionEvent) => keep((e.reason as Error)?.message ?? e.reason);
    const onOpen = (e: Event) => {
      setError((e as CustomEvent<string | undefined>).detail ?? lastError);
      setBody(""); setMsg(null); setSent(false); setOpen(true);
      supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onReject);
    window.addEventListener("scrumline:report", onOpen);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onReject);
      window.removeEventListener("scrumline:report", onOpen);
    };
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const { error: err } = await supabase.rpc("report_problem", {
      p_body: body,
      p_page: window.location.pathname,
      p_error: error ?? null,
      p_device: `${navigator.userAgent} · ${window.innerWidth}×${window.innerHeight}`,
      p_email: signedIn ? null : email,
    });
    setBusy(false);
    if (err) setMsg(err.message.includes("fetch") ? "We couldn't send that. Check your connection and try again." : err.message);
    else setSent(true);
  }

  if (!open) return null;
  return (
    <div className="wip-dim" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="wip-sheet" role="dialog" aria-label="Report a problem">
        {sent ? (
          <>
            <h2>Thanks, we&apos;ve got it</h2>
            <p className="sub">{signedIn || email ? "We'll look into it and reply by email if we need more." : "We'll look into it."}</p>
            <button type="button" onClick={() => setOpen(false)}>Done</button>
          </>
        ) : (
          <form onSubmit={submit} className="stack">
            <h2>Report a problem</h2>
            <p className="sub" style={{ margin: 0 }}>Tell us what happened and what you were trying to do. It goes straight to the person who runs Scrumline.</p>
            <textarea required minLength={3} maxLength={2000} rows={5} placeholder="What went wrong?" value={body} onChange={(e) => setBody(e.target.value)} />
            {!signedIn && (
              <input type="email" placeholder="Your email, so we can reply" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            )}
            {error && <p className="small muted" style={{ margin: 0 }}>We&apos;ll include the error you saw and which page you were on.</p>}
            {msg && <p className="small" style={{ color: "var(--danger)", margin: 0 }}>{msg}</p>}
            <div className="wip-row">
              <button type="button" className="ghost" onClick={() => setOpen(false)}>Cancel</button>
              <button type="submit" disabled={busy || body.trim().length < 3} style={{ flex: 1 }}>{busy ? "Sending…" : "Send"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
