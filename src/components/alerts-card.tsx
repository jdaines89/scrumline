"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { canInstall, install, isInstalled, onInstallChange, pushState, turnOn, type PushState } from "@/lib/push";
import { installHow, type InstallHow } from "@/lib/install";

const KEY = "sl:alerts-later";
const LATER = 5 * 864e5;

/**
 * A quiet card for players who don't get phone alerts yet, so tags, replies,
 * prizes and kickoff reminders actually reach them. One tap where the phone
 * allows it; the home-screen steps where it doesn't (iPhones). "Not now" hides
 * it for a few days on this phone.
 */
export function AlertsCard() {
  const [state, setState] = useState<PushState | null>(null);
  const [how, setHow] = useState<InstallHow | null>(null);
  const [installable, setInstallable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    let later = 0;
    try { later = Number(localStorage.getItem(KEY)) || 0; } catch { /* private mode: show it */ }
    setHidden(Date.now() - later < LATER);
    pushState().then(setState);
    setHow(installHow(navigator.userAgent, navigator.platform, navigator.maxTouchPoints));
    setInstallable(canInstall());
    return onInstallChange(() => setInstallable(canInstall()));
  }, []);

  function notNow() {
    try { localStorage.setItem(KEY, String(Date.now())); } catch { /* fine */ }
    setHidden(true);
  }

  async function on() {
    setBusy(true); setErr(null);
    const e = await turnOn();
    setBusy(false);
    if (e) setErr(e);
    setState(await pushState());
  }

  // Nothing to offer: already on, blocked (only phone settings can fix that), or a browser without push.
  if (hidden || !state || state === "on" || state === "blocked" || (state === "unsupported" && isInstalled())) return null;

  const home = state === "needs-home-screen" || state === "unsupported";
  return (
    <div className="card alerts-card">
      <div className="alerts-text">
        <strong>Get alerts on this phone</strong>
        <span className="small muted">
          {home
            ? how === "in-app"
              ? "This page is open inside another app. Open it in Safari or Chrome and add Scrumline to your home screen to get alerts."
              : how === "ios-safari" || how === "ios-other"
                ? "iPhones only send alerts from the home-screen app. Tap Share, choose Add to Home Screen, then open Scrumline from there and tap Turn on."
                : "Add Scrumline to your home screen from your browser's menu, then open it from there to turn alerts on."
            : "Kickoff reminders, when someone tags or replies to you, and when you win a prize."}
        </span>
        {err && <span className="small" style={{ color: "var(--danger)" }}>{err}</span>}
      </div>
      <div className="alerts-acts">
        {!home && <button type="button" onClick={on} disabled={busy}>{busy ? "Turning on…" : "Turn on"}</button>}
        {home && installable && <button type="button" onClick={() => install()}>Install</button>}
        {home && !installable && <Link className="linkish" href="/me/">How</Link>}
        <button type="button" className="ghost" onClick={notNow}>Not now</button>
      </div>
    </div>
  );
}
