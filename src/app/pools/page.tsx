"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useLeague } from "@/components/league";
import { InviteCard } from "@/components/invite-card";
import { PrizeSetup } from "@/components/prize-setup";
import { SchoolProjectLine } from "@/components/projects-section";
import { supabase } from "@/lib/supabase";
import { PoolName } from "@/components/pool-name";

interface Mate { pool_id: number; user_id: string }

export default function PoolsPage() {
  const { season, pools, pool, setPool, reloadPools, members, me } = useLeague();
  const [mates, setMates] = useState<Mate[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [myCode, setMyCode] = useState<string | null>(null);
  const names = new Map(members.map((m) => [m.user_id, m.display_name]));

  useEffect(() => {
    if (!pools.length) { setMates([]); return; }
    supabase.from("pool_members").select("pool_id, user_id").in("pool_id", pools.map((p) => p.id))
      .then(({ data }) => setMates((data ?? []) as Mate[]));
  }, [pools]);

  useEffect(() => {
    supabase.rpc("my_invite").then(({ data }) => setMyCode(((data ?? []) as { code: string }[])[0]?.code ?? null));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    const { data, error } = await supabase.from("pools").insert({ season: season.id, name: name.trim(), created_by: me.user_id }).select().single();
    if (error) { setMsg(error.message); return; }
    setName(""); await reloadPools(); setPool(data.id);
  }

  async function join(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    const { data, error } = await supabase.rpc("join_pool", { p_code: code });
    if (error) { setMsg(error.message); return; }
    setCode(""); await reloadPools(); setPool(data as number);
  }

  async function share(id: number, joinCode: string, poolName: string) {
    const site = `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}`;
    const text = `Join my ${season.name} pool "${poolName}" on Scrumline with code ${joinCode} on the Pools screen.`
      + (myCode ? ` New to Scrumline? Sign up with my link first: ${site}/join/?c=${myCode}` : ` ${site}/pools/`);
    try {
      if (navigator.share) await navigator.share({ text });
      else await navigator.clipboard.writeText(text);
      setCopied(id);
    } catch { /* dismissed */ }
  }

  return (
    <>
      <div className="card">
        <h2>Your pools for {season.name}</h2>
        <p className="sub">A pool is a leaderboard and a chat. Your calls for {season.name} count in every pool you&apos;re in.
          Save your schools on your profile and you&apos;re in their pools automatically. Only Scrumline makes school pools, and they carry a tick.</p>
        {pools.length === 0 && <p className="muted">None yet. Start one below, or join with a code from a mate.</p>}
        {pools.map((p) => {
          const inIt = mates.filter((m) => m.pool_id === p.id);
          return (
            <div key={p.id} className={`poolrow${p.id === pool?.id ? " on" : ""}`}>
              <div className="grow">
                <button type="button" className="linkish" onClick={() => setPool(p.id)}><strong><PoolName pool={p} /></strong></button>
                <div className="small muted">{inIt.map((m) => m.user_id === me.user_id ? "You" : names.get(m.user_id) ?? "?").join(", ")}</div>
              </div>
              {p.school_emis ? (
                <span className="small muted">{p.school_year ? "Your class" : `Your ${p.school_stage === "primary" ? "primary" : "high"} school`}</span>
              ) : (
                <>
                  <div className="code">
                    <span className="small muted">Code</span>
                    <strong>{p.join_code}</strong>
                  </div>
                  <button type="button" className="ghost" onClick={() => share(p.id, p.join_code, p.name)}>{copied === p.id ? "Copied" : "Invite"}</button>
                </>
              )}
            </div>
          );
        })}
      </div>
      <SchoolProjectLine />
      <PrizeSetup />
      <div className="grid2">
        <form className="card" onSubmit={create}>
          <h2>Start a pool</h2>
          <p className="sub">You get a code to send to your mates.</p>
          <div className="row">
            <input required maxLength={40} placeholder="Pool name" value={name} onChange={(e) => setName(e.target.value)} />
            <button type="submit">Start</button>
          </div>
        </form>
        <form className="card" onSubmit={join}>
          <h2>Join a pool</h2>
          <p className="sub">Type the six-character code you were sent.</p>
          <div className="row">
            <input required maxLength={6} placeholder="e.g. 7K2Q9D" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
              style={{ textTransform: "uppercase", letterSpacing: ".12em" }} />
            <button type="submit">Join</button>
          </div>
        </form>
      </div>
      {msg && <div className="notice">{msg}</div>}
      <InviteCard />
    </>
  );
}
