"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface Mine { code: string; used: number; cap: number }

/** Your own link for bringing people into Scrumline. */
export function InviteCard() {
  const [mine, setMine] = useState<Mine | null>(null);
  const [copied, setCopied] = useState(false);
  const [school, setSchool] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc("my_invite").then(({ data }) => setMine(((data ?? []) as Mine[])[0] ?? null));
    // Your high school if you've saved one, else your primary: the one your invites help.
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from("member_schools").select("stage, schools(name)").eq("user_id", user.id).then(({ data }) => {
        const rows = (data ?? []) as unknown as { stage: string; schools: { name: string } | null }[];
        const pick = rows.find((r) => r.stage === "high") ?? rows[0];
        setSchool(pick?.schools?.name ?? null);
      });
    });
  }, []);

  if (!mine) return null;
  const link = `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/join/?c=${mine.code}`;
  const full = mine.used >= mine.cap;

  async function share() {
    const text = school
      ? `Join me on Scrumline and play for ${school}. Rugby prediction pools with your mates and your school: ${link}`
      : `Join me on Scrumline, rugby prediction pools with your mates and your school: ${link}`;
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
      <h2>Invite mates to Scrumline</h2>
      <p className="sub">
        {school
          ? <>Every mate who joins and plays makes <strong>{school}</strong> stronger on the schools table, and a school with more players is worth more to sponsors. Your link lets them play straight away, and if they went there too, it confirms them.</>
          : "Your own link. Whoever joins through it plays straight away, and if you went to the same school it counts as your confirmation for them."}
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
