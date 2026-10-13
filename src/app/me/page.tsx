"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { AvatarPicker } from "@/components/avatar-picker";
import { BlockedPeople } from "@/components/blocked-people";
import { MySchools } from "@/components/my-schools";
import { reportProblem } from "@/components/report-problem";
import { NotifySettings } from "@/components/notify-settings";
import { Tabs } from "@/components/tabs";
import { useLeague } from "@/components/league";
import { signOut } from "@/lib/push";
import { supabase } from "@/lib/supabase";
import { setPreview, TRIAL_SPONSORS, usePreview } from "@/lib/preview";

/** Your picture, name, team, schools, notifications and password, in one place. */
export default function MePage() {
  const { me, members } = useLeague();
  const [first, setFirst] = useState(me.first_name ?? "");
  const [last, setLast] = useState(me.last_name ?? "");
  const [known, setKnown] = useState(me.known_as ?? "");
  const [team, setTeam] = useState(me.team_name ?? "");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [openProfile, setOpenProfile] = useState(!!me.open_profile);
  const [held, setHeld] = useState<number | null>(null);
  const [recruited, setRecruited] = useState<number | null>(null);
  useEffect(() => {
    supabase.rpc("my_recruits").then(({ data }) => setRecruited((data as number | null) ?? 0));
  }, []);
  useEffect(() => {
    if (me.is_admin) supabase.rpc("mod_waiting").then(({ data }) => setHeld((data as number | null) ?? 0));
  }, [me.is_admin]);

  const say = (ok: boolean, text: string) => setMsg({ ok, text });

  const namesChanged = first.trim() !== (me.first_name ?? "") || last.trim() !== (me.last_name ?? "")
    || known.trim() !== (me.known_as ?? "") || team.trim() !== (me.team_name ?? "");

  async function saveNames(e: FormEvent) {
    e.preventDefault();
    if (!first.trim() || !last.trim() || !team.trim()) return say(false, "First name, surname and team name are all needed.");
    if (members.some((m) => m.user_id !== me.user_id && m.team_name?.toLowerCase() === team.trim().toLowerCase()))
      return say(false, "Someone already plays as that team. Pick another.");
    const { error } = await supabase.from("members")
      .update({ first_name: first.trim(), last_name: last.trim(), known_as: known.trim() || null, team_name: team.trim() })
      .eq("user_id", me.user_id);
    if (error) return say(false, error.code === "23505" ? "Someone already plays as that team. Pick another." : error.message);
    window.location.reload();
  }

  async function saveOpen(value: boolean) {
    setOpenProfile(value);
    const { error } = await supabase.from("members").update({ open_profile: value }).eq("user_id", me.user_id);
    if (error) { setOpenProfile(!value); say(false, error.message); }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return say(false, "Use at least 8 characters.");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return say(false, error.message);
    setPassword("");
    say(true, "Password changed.");
  }


  return (
    <div className="mepage">
      {msg && <p className="small mepage-msg" style={{ color: msg.ok ? "var(--accent)" : "var(--danger)" }}>{msg.text}</p>}
      <div className="card myschools-card">
        <h2>Your schools</h2>
        <p className="sub">Every call you make counts for the schools you went to</p>
        <MySchools me={me} members={members} onMessage={say} />
      </div>

      <div className="grid2">
        <div className="card">
          <h2>Your profile</h2>
          <p className="sub">{me.email}</p>
          {recruited !== null && (
            <p className="small muted recruited">
              {recruited > 0
                ? <>Brought in <strong>{recruited}</strong> player{recruited === 1 ? "" : "s"}. Thanks for growing the league.</>
                : <>You haven&apos;t brought anyone in yet. Your invite link is on <Link href="/leagues/">Leagues</Link>.</>}
            </p>
          )}

          <AvatarPicker me={me} onMessage={say} />

          <form onSubmit={saveNames} className="stack profile">
            <div className="row names-row">
              <label className="small muted">First name<input required maxLength={40} autoComplete="given-name" value={first} onChange={(e) => setFirst(e.target.value)} /></label>
              <label className="small muted">Surname<input required maxLength={40} autoComplete="family-name" value={last} onChange={(e) => setLast(e.target.value)} /></label>
            </div>
            <label className="small muted">Known as at school (optional). Chat and tags use it, otherwise your first name.
              <input maxLength={24} value={known} onChange={(e) => setKnown(e.target.value)} />
            </label>
            <label className="small muted">Team name, the same in every tournament
              <input required maxLength={30} value={team} onChange={(e) => setTeam(e.target.value)} />
            </label>
            <div><button type="submit" disabled={!namesChanged}>Save</button></div>
          </form>

          <div className="profile-who">
            <strong id="who-sees-profile">Who can see your profile</strong>
            <p className="small muted">People in your leagues can always see it.</p>
            <div className="seg wide" role="radiogroup" aria-labelledby="who-sees-profile">
              {([[false, "Just my leagues"], [true, "Everyone"]] as const).map(([v, text]) => (
                <button key={text} type="button" role="radio" aria-checked={openProfile === v} className={openProfile === v ? "on" : ""}
                  onClick={() => openProfile !== v && saveOpen(v)}>{text}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="mepage-side">
          <NotifySettings me={me} onMessage={say} />

          <TrialSwitch />

          <BlockedPeople members={members} />

          <div className="card">
            <h2>Account</h2>
            <form onSubmit={savePassword} className="stack profile">
              <label className="small muted">New password</label>
              <div className="row">
                <input type="password" autoComplete="new-password" placeholder="8+ characters" value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="submit" disabled={!password}>Change</button>
              </div>
            </form>


            <div className="me-biz">
              <strong>Own a business?</strong>
              <span className="small muted">Back a school, see what sponsors give, and set up your business profile.</span>
              <div className="row"><Link className="btn" href="/sponsor/">Sponsor a school</Link><Link className="btn ghostlink" href="/sponsor/profile/">Business profile</Link></div>
            </div>
            <div className="me-biz">
              <strong>Look after your school&apos;s account?</strong>
              <span className="small muted">Principals, bursars, governing bodies and alumni offices can claim the school and receive what sponsors give it.</span>
              <div className="row"><Link className="btn ghostlink" href="/schools/">Claim your school</Link></div>
            </div>
            <div className="me-biz">
              <strong>Something not working?</strong>
              <span className="small muted">Tell us what went wrong and we&apos;ll fix it.</span>
              <div className="row"><button type="button" className="ghost" onClick={() => reportProblem()}>Report a problem</button></div>
            </div>
            <button type="button" className="ghost" style={{ marginTop: 6 }} onClick={() => signOut()}>Sign out</button>
          </div>
          {me.is_admin && (
            <div className="card">
              <h2>Running Scrumline</h2>
              <p className="sub">{held ? `${held} waiting for review` : "Only admins see this."}</p>
              <div className="row"><Link className="btn" href="/admin/">Open admin</Link></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Made-up businesses filling the sponsor spots, so players can see how sponsorship will look. */
function TrialSwitch() {
  const on = usePreview();
  if (!TRIAL_SPONSORS) return null;
  return (
    <div className="card">
      <div className="me-visibility">
        <div className="pref-text">
          <strong>Trial sponsors</strong>
          <span className="small muted">Made-up businesses show where real sponsors will appear, each marked Trial. No money moves. <Link href="/sponsor/results/">See what a business sees</Link></span>
        </div>
        <Tabs size="sub" label="Trial sponsors" items={[["on", "Show"], ["off", "Hide"]] as const}
          value={on ? "on" : "off"} onPick={(v) => setPreview(v === "on")} />
      </div>
    </div>
  );
}
