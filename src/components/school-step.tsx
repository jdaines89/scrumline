"use client";

import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import type { Member, School } from "@/lib/types";

type Stage = "high" | "primary";
const YEAR: Record<Stage, string> = { high: "Matric year", primary: "Year you finished primary school" };

/**
 * Asked once, straight after "Who's playing?": the school you went to. Saving
 * puts you in its league and your class league at once; "Skip for now" never
 * pops up again, and the school can still be added from Leagues or your profile.
 * Opened again from Leagues, `onLater` closes it without noting anything.
 */
export function SchoolStep({ me, onJoined, onDone, onLater }: {
  me: Member; onJoined: () => Promise<void>; onDone: (m: Member) => void; onLater?: () => void;
}) {
  const [stage, setStage] = useState<Stage>("high");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<School[]>([]);
  const [pick, setPick] = useState<School | null>(null);
  const [year, setYear] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [joined, setJoined] = useState<{ school: School; year: number; member: Member } | null>(null);

  useEffect(() => {
    const text = q.trim();
    if (pick || text.replace(/\s/g, "").length < 3) { setHits([]); return; }
    let live = true;
    // Finds nicknames too ("Paarl Boys", "Affies"), ignoring accents and punctuation.
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("search_schools", { p_query: text, p_stage: stage });
      if (live) setHits(((data ?? []) as School[]).slice(0, 6));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q, stage, pick]);

  // Never blocks: if the note doesn't save, the question still goes away for this visit.
  async function asked(): Promise<Member> {
    const at = new Date().toISOString();
    const { data, error } = await supabase.from("members").update({ school_asked_at: at })
      .eq("user_id", me.user_id).select().single();
    return error ? { ...me, school_asked_at: at } : (data as Member);
  }

  async function skip() {
    setBusy(true);
    const m = await asked();
    setBusy(false);
    onDone(m);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const y = Number(year);
    const now = new Date().getFullYear();
    if (!pick) { setMsg("Pick your school from the list."); return; }
    if (!Number.isInteger(y) || y < 1940 || y > now) { setMsg(`Add your ${YEAR[stage].toLowerCase()}, like 1997.`); return; }
    setBusy(true);
    const { error } = await supabase.from("member_schools").insert({ user_id: me.user_id, stage, emis: pick.emis, last_year: y });
    if (error) { setBusy(false); setMsg(error.message); return; }
    const m = await asked();
    await onJoined();
    setBusy(false);
    setJoined({ school: pick, year: y, member: m });
  }

  function switchStage(s: Stage) {
    setStage(s); setPick(null); setQ(""); setHits([]); setMsg(null);
  }

  if (joined) {
    return (
      <div className="wip-dim" role="dialog" aria-modal="true" aria-labelledby="sch-title">
        <div className="wip-sheet">
          <h2 id="sch-title">You&apos;re in</h2>
          <p className="sub">You&apos;ve joined two school leagues. Your scores count in both, alongside your other leagues.</p>
          <ul className="sch-joined">
            <li><span className="sch-joined-name">{joined.school.name}</span><span className="small muted">Everyone from the school</span></li>
            <li><span className="sch-joined-name">Class of {joined.year}</span><span className="small muted">The people in your year, with its own chat</span></li>
          </ul>
          <p className="small muted" style={{ margin: "12px 0 0" }}>Find them under Leagues. Two schoolmates confirming you makes your points count for the school.</p>
          <button type="button" className="wip-save" onClick={() => onDone(joined.member)}>Carry on</button>
        </div>
      </div>
    );
  }

  return (
    <div className="wip-dim" role="dialog" aria-modal="true" aria-labelledby="sch-title">
      <form className="wip-sheet" onSubmit={save}>
        <h2 id="sch-title">Where did you go to school?</h2>
        <p className="sub">We&apos;ll put you in your school&apos;s league and your class&apos;s league, so you can play against old schoolmates.</p>
        <div className="sch-stage" role="radiogroup" aria-label="School">
          {(["high", "primary"] as Stage[]).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={stage === s}
              className={stage === s ? "on" : ""} onClick={() => switchStage(s)}>
              {s === "high" ? "High school" : "Primary school"}
            </button>
          ))}
        </div>
        {pick ? (
          <div className="sch-pick">
            <div>
              <div className="sch-joined-name">{pick.name}</div>
              {pick.town && <div className="small muted">{pick.town}</div>}
            </div>
            <button type="button" className="ghost" onClick={() => { setPick(null); setQ(""); }}>Change</button>
          </div>
        ) : (
          <label>School name or nickname
            <input autoComplete="off" placeholder="e.g. Paul Roos or Affies" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        )}
        {!pick && hits.length > 0 && (
          <ul className="school-hits">
            {hits.map((s) => (
              <li key={s.emis}>
                <button type="button" onClick={() => { setPick(s); setHits([]); }}>
                  <span>{s.name}</span>
                  <span className="small muted">{s.town}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <label>{YEAR[stage]}
          <input type="number" inputMode="numeric" placeholder="e.g. 1997" value={year}
            onChange={(e) => setYear(e.target.value.slice(0, 4))} />
        </label>
        <p className="wip-hint">You can change it for 14 days, then it&apos;s fixed. Add your other school on your profile.</p>
        {msg && <p className="small" style={{ color: "var(--danger)", margin: "10px 0 0" }}>{msg}</p>}
        <button type="submit" className="wip-save" disabled={busy || !pick}>{busy ? "Joining…" : "Join my school's leagues"}</button>
        <button type="button" className="sch-skip" disabled={busy} onClick={onLater ?? skip}>{onLater ? "Not now" : "Skip for now"}</button>
      </form>
    </div>
  );
}
