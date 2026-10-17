"use client";

import { useEffect, useState } from "react";
import { canInstall, install, isInstalled, onInstallChange, pushState, turnOn, type PushState } from "@/lib/push";
import { alertsOffer } from "@/lib/install";
import { logEvent } from "@/lib/events";

const KEY = "sl:alerts-later";
const LATER = 5 * 864e5;
const NO_INSTALL = "sl:install-no";

/**
 * A quiet card for players who don't get phone alerts yet, so tags, replies,
 * prizes and kickoff reminders actually reach them. It never asks anyone to
 * install the app unless their browser can do it in one tap; "Not now" on that
 * offer is remembered for good, and on "Turn on" it hides it for a few days.
 */
export function AlertsCard() {
  const [state, setState] = useState<PushState | null>(null);
  const [installable, setInstallable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hidden, setHidden] = useState(true);
  const [noInstall, setNoInstall] = useState(true);

  useEffect(() => {
    let later = 0;
    try { later = Number(localStorage.getItem(KEY)) || 0; } catch { /* private mode: show it */ }
    setHidden(Date.now() - later < LATER);
    try { setNoInstall(!!localStorage.getItem(NO_INSTALL)); } catch { setNoInstall(false); }
    pushState().then(setState);
    setInstallable(canInstall());
    return onInstallChange(() => setInstallable(canInstall()));
  }, []);

  const offer = state ? alertsOffer(state, installable, isInstalled()) : null;
  const showing = !!offer && !(offer === "turn-on" ? hidden : noInstall);
  useEffect(() => {
    if (!showing || !state) return;
    // Once per browser session, so a page reload doesn't count twice.
    try { if (sessionStorage.getItem("sl:alerts-shown")) return; sessionStorage.setItem("sl:alerts-shown", "1"); } catch { /* log anyway */ }
    logEvent("alerts_shown", { state });
  }, [showing, state]);

  function notNow() {
    logEvent("alerts_later", { state: state ?? "unknown" });
    try { localStorage.setItem(offer === "install" ? NO_INSTALL : KEY, String(Date.now())); } catch { /* fine */ }
    if (offer === "install") setNoInstall(true); else setHidden(true);
  }

  async function on() {
    setBusy(true); setErr(null);
    const e = await turnOn();
    setBusy(false);
    if (e) setErr(e);
    setState(await pushState());
  }

  // Nothing to offer: already on, blocked (only phone settings can fix that), or no one-tap install.
  if (!showing || !state) return null;

  const home = offer === "install";
  return (
    <div className="card alerts-card">
      <div className="alerts-text">
        <strong>Get alerts on this phone</strong>
        <span className="small muted">
          {home
            ? "This browser can install Scrumline in one tap, then alerts can reach you. Everything works here too."
            : "Kickoff reminders, when someone tags or replies to you, and when you win a prize."}
        </span>
        {err && <span className="small" style={{ color: "var(--danger)" }}>{err}</span>}
      </div>
      <div className="alerts-acts">
        {!home && <button type="button" onClick={on} disabled={busy}>{busy ? "Turning on…" : "Turn on"}</button>}
        {home && <button type="button" onClick={() => install()}>Install</button>}
        <button type="button" className="ghost" onClick={notNow}>Not now</button>
      </div>
    </div>
  );
}
