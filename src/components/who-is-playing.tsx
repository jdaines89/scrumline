"use client";

import { useState, type FormEvent } from "react";
import { fullName, suggestTeams } from "@/lib/names";
import { supabase } from "@/lib/supabase";
import type { Member } from "@/lib/types";

/** Whether an old display name looks like a name someone chose (not their email's start or a "Player" stand-in). */
function chosenName(m: Member): string {
  const local = m.email.split("@")[0].toLowerCase();
  const n = m.display_name.trim();
  return n.toLowerCase() === local || /^Player [0-9A-F]{6}$/.test(n) ? "" : n;
}

/**
 * Asked once of everyone, and can't be skipped: real name for accountability,
 * the nickname schoolmates knew you by, and the one team name you play under.
 */
export function WhoIsPlaying({ me, members, onDone }: { me: Member; members: Member[]; onDone: (m: Member) => void }) {
  const old = chosenName(me);
  const [first, setFirst] = useState(me.first_name ?? "");
  const [last, setLast] = useState(me.last_name ?? "");
  const [known, setKnown] = useState(me.known_as ?? (me.first_name ? "" : old));
  const [team, setTeam] = useState(me.team_name ?? "");
  const [seed, setSeed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const taken = members.filter((m) => m.user_id !== me.user_id && m.team_name).map((m) => m.team_name!);
  const ideas = suggestTeams(taken, seed);
  const preview = { display_name: me.display_name, first_name: first.trim() || null, last_name: last.trim() || null, known_as: known.trim() || null };

  async function save(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const t = team.trim();
    if (taken.some((x) => x.toLowerCase() === t.toLowerCase())) { setMsg("Someone already plays as that team. Pick another."); return; }
    setBusy(true);
    const { data, error } = await supabase.from("members")
      .update({ first_name: first.trim(), last_name: last.trim(), known_as: known.trim() || null, team_name: t })
      .eq("user_id", me.user_id).select().single();
    setBusy(false);
    if (error) {
      setMsg(error.code === "23505" ? "Someone already plays as that team. Pick another." : error.message);
      return;
    }
    onDone(data as Member);
  }

  return (
    <div className="wip-dim" role="dialog" aria-modal="true" aria-labelledby="wip-title">
      <form className="wip-sheet" onSubmit={save}>
        <h2 id="wip-title">Who&apos;s playing?</h2>
        <p className="sub">Quick one so schoolmates can find you. Only signed-in Scrumline players can see your name.</p>
        <div className="wip-row">
          <label>First name<input required maxLength={40} autoComplete="given-name" value={first} onChange={(e) => setFirst(e.target.value)} /></label>
          <label>Surname<input required maxLength={40} autoComplete="family-name" value={last} onChange={(e) => setLast(e.target.value)} /></label>
        </div>
        <label>Known as at school <span className="wip-opt">(optional)</span>
          <input maxLength={24} placeholder="e.g. a nickname or middle name" value={known} onChange={(e) => setKnown(e.target.value)} />
        </label>
        {old && !me.first_name && <p className="wip-hint">Filled in from your old display name. Clear it if you don&apos;t use one.</p>}
        <label>Team name
          <input required maxLength={30} placeholder="Your team, for every tournament" value={team} onChange={(e) => setTeam(e.target.value)} />
        </label>
        <div className="wip-chips">
          {ideas.map((s) => <button key={s} type="button" className="wip-chip" onClick={() => setTeam(s)}>{s}</button>)}
          <button type="button" className="wip-chip" onClick={() => setSeed(seed + 1)}>↻ More</button>
        </div>
        {first.trim() && last.trim() && team.trim() && (
          <p className="wip-preview">Others will see you as <strong>{team.trim()}</strong> · {fullName(preview)}</p>
        )}
        {msg && <p className="small" style={{ color: "var(--danger)", margin: "10px 0 0" }}>{msg}</p>}
        <button type="submit" className="wip-save" disabled={busy}>{busy ? "Saving…" : "Save and carry on"}</button>
      </form>
    </div>
  );
}
