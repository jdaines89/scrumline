"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { AvatarPicker } from "@/components/avatar-picker";
import { BlockedPeople } from "@/components/blocked-people";
import { MySchools } from "@/components/my-schools";
import { NotifySettings } from "@/components/notify-settings";
import { Numbers } from "@/components/numbers";
import { useLeague } from "@/components/league";
import { signOut } from "@/lib/push";
import { supabase } from "@/lib/supabase";

/** Your picture, name, team, schools, notifications and password, in one place. */
export default function MePage() {
  const { me, members, season } = useLeague();
  const [first, setFirst] = useState(me.first_name ?? "");
  const [last, setLast] = useState(me.last_name ?? "");
  const [known, setKnown] = useState(me.known_as ?? "");
  const [team, setTeam] = useState(me.team_name ?? "");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
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
      <div className="grid2">
        <div className="card">
          <h2>Your profile</h2>
          <p className="sub">{me.email}</p>
          {recruited !== null && (
            <p className="small muted recruited">
              {recruited > 0
                ? <>Brought in <strong>{recruited}</strong> player{recruited === 1 ? "" : "s"}. Thanks for growing the league.</>
                : <>You haven&apos;t brought anyone in yet. Your invite link is on <Link href="/pools/">Leagues</Link>.</>}
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
        </div>

        <div className="mepage-side">
          <div className="card">
            <h2>Your schools</h2>
            <p className="sub">Where you went, so you can play for them</p>
            <MySchools me={me} members={members} onMessage={say} />
          </div>

          <NotifySettings me={me} onMessage={say} />

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
            <button type="button" className="ghost" style={{ marginTop: 6 }} onClick={() => signOut()}>Sign out</button>
          </div>
          {me.is_admin && (
            <div className="card">
              <h2>Running Scrumline</h2>
              <p className="sub">Only admins see this.</p>
              <nav className="admin-links">
                <Link href="/admin/metrics/">Growth targets<span>Weekly callers and the sprint target</span></Link>
                <Link href="/admin/pack/">Sponsor pack<span>One page to send a business</span></Link>
                <Link href="/admin/schools/">Schools<span>Claims and payouts</span></Link>
                <Link href="/admin/projects/">School projects<span>List, settle and prove</span></Link>
                <Link href="/admin/sponsors/">Sponsors<span>Bookings and approvals</span></Link>
                <Link href="/admin/moderation/">Moderation<span>{held ? `${held} waiting for review` : "Nothing waiting"}</span></Link>
              </nav>
            </div>
          )}
        </div>
      </div>
      {me.is_admin && <Numbers season={season.id} seasonName={season.name} />}
    </div>
  );
}
