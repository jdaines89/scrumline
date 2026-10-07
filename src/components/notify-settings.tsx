"use client";

import { useEffect, useState } from "react";
import { canInstall, install, isInstalled, onInstallChange, pushState, turnOff, turnOn, type PushState } from "@/lib/push";
import { installHow, type InstallHow } from "@/lib/install";
import { supabase } from "@/lib/supabase";
import type { Member } from "@/lib/types";

/**
 * Notifications on this phone, what they're for, and getting the app onto
 * the home screen (which iPhones need before they'll allow notifications).
 */
export function NotifySettings({ me, onMessage }: { me: Member; onMessage: (ok: boolean, text: string) => void }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [remind, setRemind] = useState<"off" | "push" | "email">(!me.email_reminders ? "off" : me.reminder_by === "email" ? "email" : "push");
  const [tags, setTags] = useState(me.push_mentions);
  const [results, setResults] = useState(me.push_results ?? true);
  const [installable, setInstallable] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [how, setHow] = useState<InstallHow | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    pushState().then(setState);
    setInstalled(isInstalled());
    setInstallable(canInstall());
    setHow(installHow(navigator.userAgent, navigator.platform, navigator.maxTouchPoints));
    return onInstallChange(() => { setInstallable(canInstall()); setInstalled(isInstalled()); });
  }, []);

  async function on() {
    setBusy(true);
    const err = await turnOn();
    setBusy(false);
    if (err) onMessage(false, err);
    setState(await pushState());
  }

  async function off() {
    setBusy(true);
    await turnOff();
    setBusy(false);
    setState(await pushState());
  }

  async function save(field: "push_mentions" | "push_results", value: boolean, set: (v: boolean) => void) {
    set(value);
    const { error } = await supabase.from("members").update({ [field]: value }).eq("user_id", me.user_id);
    if (error) { set(!value); onMessage(false, error.message); }
  }

  async function saveRemind(value: "off" | "push" | "email") {
    const was = remind;
    setRemind(value);
    const change = value === "off" ? { email_reminders: false } : { email_reminders: true, reminder_by: value };
    const { error } = await supabase.from("members").update(change).eq("user_id", me.user_id);
    if (error) { setRemind(was); onMessage(false, error.message); }
  }

  const pushOn = state === "on";
  // Without push on this phone, a saved "push" choice is delivered by email, so show it as Email.
  const shownRemind = remind === "push" && !pushOn ? "email" : remind;
  return (
    <div className="card notify">
      <h2>Notifications</h2>
      <p className="sub">Choose how each one reaches you.</p>

      <div className="notify-prefs">
        <div className="pref">
          <div className="pref-text">
            <strong>Kickoff reminders</strong>
            <span className="small muted">An hour before kickoff, if you haven&apos;t called a score</span>
          </div>
          <div className="seg sm">
            {([["off", "Off"], ["push", "Push"], ["email", "Email"]] as const).map(([v, l]) => (
              <button key={v} type="button" className={shownRemind === v ? "on" : ""} disabled={v === "push" && !pushOn} onClick={() => saveRemind(v)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="pref">
          <div className="pref-text">
            <strong>Tagged in chat</strong>
            <span className="small muted">When someone tags you in a league&apos;s chat</span>
          </div>
          <div className="seg sm">
            <button type="button" className={!tags || !pushOn ? "on" : ""} onClick={() => save("push_mentions", false, setTags)}>Off</button>
            <button type="button" className={tags && pushOn ? "on" : ""} disabled={!pushOn} onClick={() => save("push_mentions", true, setTags)}>Push</button>
          </div>
        </div>
        <div className="pref">
          <div className="pref-text">
            <strong>Full time</strong>
            <span className="small muted">After a game you called: your points and where you stand</span>
          </div>
          <div className="seg sm">
            <button type="button" className={!results || !pushOn ? "on" : ""} onClick={() => save("push_results", false, setResults)}>Off</button>
            <button type="button" className={results && pushOn ? "on" : ""} disabled={!pushOn} onClick={() => save("push_results", true, setResults)}>Push</button>
          </div>
        </div>
      </div>

      <div className="phone-push">
        <div className="pref-text">
          <strong>Push on this phone</strong>
          <span className="small muted">{{
            on: "On. Anything set to Push comes here.",
            off: "Off. Turn it on to choose Push above.",
            blocked: "Blocked in your phone's settings. Allow notifications for Scrumline there, then come back.",
            unsupported: "This browser can't do push, so choose Email.",
            "needs-home-screen": "Push needs Scrumline on your home screen first, as below.",
          }[state ?? "off"]}</span>
        </div>
        {state === "off" && <button type="button" onClick={on} disabled={busy}>Turn on</button>}
        {state === "on" && <button type="button" className="ghost" onClick={off} disabled={busy}>Turn off</button>}
      </div>

      {!installed && installable && (
        <button type="button" className="ghost notify-install" onClick={async () => { await install(); }}>Install Scrumline on this phone</button>
      )}
      {how && !installed && !installable && (
        <div className="install">
          <div className="pref-text">
            <strong>Install Scrumline on this phone</strong>
            <span className="small muted">{{
              "in-app": "This page is open inside another app, which can't install it. Open it in Chrome or Safari, then come back here.",
              "ios-safari": "Tap the Share button at the bottom of Safari, choose Add to Home Screen, then open Scrumline from your home screen.",
              "ios-other": "Tap the Share button next to the address bar and choose Add to Home Screen. If it isn't there, open this page in Safari.",
              android: "Open your browser's menu (the three dots) and tap Install app or Add to Home screen.",
              desktop: "Open this page on your phone to add it to your home screen.",
            }[how]}</span>
          </div>
          {how === "in-app" && (
            <button type="button" className="ghost" onClick={async () => {
              try { await navigator.clipboard.writeText(location.href); setCopied(true); } catch { /* copy blocked; the words still say what to do */ }
            }}>{copied ? "Copied" : "Copy link"}</button>
          )}
        </div>
      )}
    </div>
  );
}
