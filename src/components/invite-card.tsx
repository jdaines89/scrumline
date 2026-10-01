"use client";

import { useEffect, useState } from "react";
import { plural } from "@/lib/recruits";
import { supabase } from "@/lib/supabase";

/** used: everyone the link brought in; waiting: those who haven't made a call yet, the only ones the cap counts. */
interface Mine { code: string; used: number; cap: number; waiting: number }
/** This month's recruiter prize in one of your pools, with your own count so far. */
interface Running { pool_id: number; pool_name: string; prize: string; sponsor: string; mine: number; best: number }

/** Your own link for bringing people into Scrumline. */
export function InviteCard() {
  const [mine, setMine] = useState<Mine | null>(null);
  const [copied, setCopied] = useState(false);
  const [schools, setSchools] = useState<string[]>([]);
  const [running, setRunning] = useState<Running[]>([]);

  useEffect(() => {
    supabase.rpc("my_invite").then(({ data }) => setMine(((data ?? []) as Mine[])[0] ?? null));
    supabase.rpc("my_recruiter_prizes").then(({ data }) => setRunning((data ?? []) as Running[]));
    // Both your schools count: every mate who plays can take a seat in your high school's team and your primary's.
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from("member_schools").select("stage, schools(name)").eq("user_id", user.id).then(({ data }) => {
        const rows = (data ?? []) as unknown as { stage: string; schools: { name: string } | null }[];
        const order = (r: { stage: string }) => (r.stage === "high" ? 0 : 1);
        setSchools([...rows].sort((a, b) => order(a) - order(b)).map((r) => r.schools?.name).filter((n): n is string => !!n));
      });
    });
  }, []);

  if (!mine) return null;
  const link = `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/join/?c=${mine.code}`;
  const full = mine.waiting >= mine.cap;
  const named = schools.length ? schools.join(" and ") : null;

  async function share() {
    const text = named
      ? `I'm calling every weekend's rugby on Scrumline for ${named}. Come play for our schools, back your calls against the mates and climb the table: ${link}`
      : `I'm calling every weekend's rugby on Scrumline. Come back your calls against the mates, play for your old school and climb the table: ${link}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(link); setCopied(true); }
    } catch { /* dismissed */ }
  }

  async function reset() {
    if (!window.confirm("Make a new link? The old one will stop working.")) return;
    const { data } = await supabase.rpc("reset_invite_code");
    if (data) setMine({ ...mine!, code: data as string });
    setCopied(false);
  }

  return (
    <div className="card invite">
      <h2>Bring your mates into the game</h2>
      <p className="sub">
        {named
          ? <>Every old schoolmate who plays can earn a seat in the team for <strong>{named}</strong> and push your schools up the table. More players means more bragging rights, and more that sponsors put back into your schools. Your link gets them straight in, and confirms anyone who went where you did.</>
          : "Your link gets them straight in, calling scores with you this weekend. Save your schools on your profile and every mate who plays helps push them up the schools table."}
      </p>
      {running.length > 0 && (
        <ul className="recruit-prizes">
          {running.map((r) => (
            <li key={r.pool_id}>
              <span className="prize-label">Recruiter prize · {r.pool_name}</span><br />
              <strong>{r.prize}</strong> from {r.sponsor}.{" "}
              <span className="muted">
                {r.mine > 0 ? `You've brought in ${r.mine} this month${r.mine >= r.best ? ", the most so far" : `, the leader has ${r.best}`}.`
                  : r.best > 0 ? `The leader has ${plural(r.best, "new player", "new players")} so far.` : "Nobody has brought anyone in yet."}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Your invite link" />
        <button type="button" onClick={share} disabled={full}>{copied ? "Copied" : "Share"}</button>
      </div>
      <p className="small muted invite-foot">
        {full ? `${mine.cap} people you invited haven't played yet, so the link is paused until some of them make a call.`
          : mine.used === 0 ? "Your link never runs out while the people you bring in play."
          : `${plural(mine.used, "person", "people")} joined with your link. It never runs out while they play.`}{" "}
        <button type="button" className="linkish" onClick={reset}>Reset link</button>
      </p>
    </div>
  );
}
