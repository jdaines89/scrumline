"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AvatarPicker } from "@/components/avatar-picker";
import { MySchools } from "@/components/my-schools";
import { Numbers } from "@/components/numbers";
import { useLeague } from "@/components/league";
import { supabase } from "@/lib/supabase";

/** Your picture, name, team, schools, password and reminders, in one place. */
export default function MePage() {
  const { me, members, entry, season } = useLeague();
  const [name, setName] = useState(me.display_name);
  const [team, setTeam] = useState(entry?.team_name ?? "");
  const [password, setPassword] = useState("");
  const [remind, setRemind] = useState(me.email_reminders);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const say = (ok: boolean, text: string) => setMsg({ ok, text });

  async function saveName(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (n.length < 2) return say(false, "Use at least 2 characters.");
    // Tags in chat go by name, so two people can't share one.
    if (members.some((m) => m.user_id !== me.user_id && m.display_name.toLowerCase() === n.toLowerCase()))
      return say(false, "Someone in the league already goes by that name.");
    const { error } = await supabase.from("members").update({ display_name: n }).eq("user_id", me.user_id);
    if (error) return say(false, error.message);
    window.location.reload();
  }

  async function saveTeam(e: FormEvent) {
    e.preventDefault();
    if (!entry || !team.trim()) return;
    const { error } = await supabase.from("entries").update({ team_name: team.trim() }).eq("id", entry.id);
    if (error) return say(false, error.message);
    window.location.reload();
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return say(false, "Use at least 8 characters.");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return say(false, error.message);
    setPassword("");
    say(true, "Password changed.");
  }

  async function toggleReminders(on: boolean) {
    setRemind(on);
    const { error } = await supabase.from("members").update({ email_reminders: on }).eq("user_id", me.user_id);
    if (error) { setRemind(!on); say(false, error.message); }
  }

  return (
    <div className="mepage">
      {msg && <p className="small mepage-msg" style={{ color: msg.ok ? "var(--accent)" : "var(--danger)" }}>{msg.text}</p>}
      <div className="grid2">
        <div className="card">
          <h2>Your profile</h2>
          <p className="sub">{me.email}</p>

          <AvatarPicker me={me} onMessage={say} />

          <form onSubmit={saveName} className="stack profile">
            <label className="small muted">Display name, as everyone sees it and tags you in chat</label>
            <div className="row">
              <input maxLength={24} value={name} onChange={(e) => setName(e.target.value)} />
              <button type="submit" disabled={name.trim() === me.display_name}>Save</button>
            </div>
          </form>

          {entry && (
            <form onSubmit={saveTeam} className="stack profile">
              <label className="small muted">Team name for {season.name}</label>
              <div className="row">
                <input maxLength={40} value={team} onChange={(e) => setTeam(e.target.value)} />
                <button type="submit" disabled={team.trim() === entry.team_name}>Save</button>
              </div>
            </form>
          )}
        </div>

        <div className="mepage-side">
          <div className="card">
            <h2>Your schools</h2>
            <p className="sub">Where you went, so you can play for them</p>
            <MySchools me={me} members={members} onMessage={say} />
          </div>

          <div className="card">
            <h2>Account</h2>
            <form onSubmit={savePassword} className="stack profile">
              <label className="small muted">New password</label>
              <div className="row">
                <input type="password" autoComplete="new-password" placeholder="8+ characters" value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="submit" disabled={!password}>Change</button>
              </div>
            </form>

            <label className="small muted toggle">
              <input type="checkbox" checked={remind} onChange={(e) => toggleReminders(e.target.checked)} />
              Email me an hour before kickoff if I haven&apos;t called a score
            </label>

            <p className="small muted" style={{ marginTop: 18 }}>Own a business? <Link href="/sponsor/">Sponsor a school</Link></p>
            <button type="button" className="ghost" style={{ marginTop: 6 }} onClick={() => supabase.auth.signOut()}>Sign out</button>
          </div>
        </div>
      </div>
      {me.is_admin && <Numbers season={season.id} seasonName={season.name} />}
    </div>
  );
}
