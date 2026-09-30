"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface Mine { code: string; used: number; cap: number }

/** Your own link for bringing people into Scrumline. */
export function InviteCard() {
  const [mine, setMine] = useState<Mine | null>(null);
  const [copied, setCopied] = useState(false);
  const [schools, setSchools] = useState<string[]>([]);

  useEffect(() => {
    supabase.rpc("my_invite").then(({ data }) => setMine(((data ?? []) as Mine[])[0] ?? null));
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
  const full = mine.used >= mine.cap;
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
      <div className="row">
        <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Your invite link" />
        <button type="button" onClick={share} disabled={full}>{copied ? "Copied" : "Share"}</button>
      </div>
      <p className="small muted invite-foot">
        {full ? `All ${mine.cap} invites used.` : `${mine.used} of ${mine.cap} used.`}{" "}
        <button type="button" className="linkish" onClick={reset}>Reset link</button>
      </p>
    </div>
  );
}
