"use client";

import { useEffect, useState } from "react";
import { canInstall, install, isInstalled, onInstallChange, pushState, turnOff, turnOn, type PushState } from "@/lib/push";
import { supabase } from "@/lib/supabase";
import type { Member } from "@/lib/types";

/**
 * Notifications on this phone, what they're for, and getting the app onto
 * the home screen (which iPhones need before they'll allow notifications).
 */
export function NotifySettings({ me, onMessage }: { me: Member; onMessage: (ok: boolean, text: string) => void }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [remind, setRemind] = useState(me.email_reminders);
  const [tags, setTags] = useState(me.push_mentions);
  const [installable, setInstallable] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    pushState().then(setState);
    setInstalled(isInstalled());
    setInstallable(canInstall());
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

  async function save(field: "email_reminders" | "push_mentions", value: boolean, set: (v: boolean) => void) {
    set(value);
    const { error } = await supabase.from("members").update({ [field]: value }).eq("user_id", me.user_id);
    if (error) { set(!value); onMessage(false, error.message); }
  }

  const pushOn = state === "on";
  return (
    <div className="card notify">
      <h2>Notifications</h2>
      <p className="sub">{pushOn ? "On for this phone." : "Get a nudge before kickoff and when someone tags you."}</p>

      {state === "off" && <button type="button" onClick={on} disabled={busy}>Turn on for this phone</button>}
      {state === "on" && <button type="button" className="ghost" onClick={off} disabled={busy}>Turn off for this phone</button>}
      {state === "blocked" && <p className="small muted">Notifications are blocked for Scrumline. Allow them in your phone&apos;s settings, then come back here.</p>}
      {state === "unsupported" && <p className="small muted">This browser can&apos;t show notifications. Reminders come by email instead.</p>}
      {state === "needs-home-screen" && (
        <div className="howto">
          <p className="small">On iPhone, notifications work once Scrumline is on your home screen:</p>
          <ol className="small muted">
            <li>Tap the Share button at the bottom of Safari</li>
            <li>Choose Add to Home Screen</li>
            <li>Open Scrumline from your home screen and come back here</li>
          </ol>
        </div>
      )}

      <div className="notify-prefs">
        <label className="small muted toggle">
          <input type="checkbox" checked={remind} onChange={(e) => save("email_reminders", e.target.checked, setRemind)} />
          An hour before kickoff if I haven&apos;t called a score{pushOn ? "" : " (by email)"}
        </label>
        <label className="small muted toggle">
          <input type="checkbox" checked={tags} disabled={!pushOn} onChange={(e) => save("push_mentions", e.target.checked, setTags)} />
          When someone tags me in chat{pushOn ? "" : " (needs notifications on)"}
        </label>
      </div>

      {!installed && installable && (
        <button type="button" className="ghost notify-install" onClick={async () => { await install(); }}>Install Scrumline on this phone</button>
      )}
    </div>
  );
}
