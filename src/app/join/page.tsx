"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readJoinLink } from "@/lib/join-link";
import { supabase } from "@/lib/supabase";

// Signed out, AuthGate shows the join form here instead. Signed in, a league
// link (?p=CODE) joins that league; otherwise there's nothing to join.
export default function JoinPage() {
  const [state, setState] = useState<"none" | "joining" | "failed">("none");

  useEffect(() => {
    const p = readJoinLink(window.location.search).league;
    if (!p) return;
    setState("joining");
    supabase.rpc("join_pool", { p_code: p }).then(({ data, error }) => {
      if (error) { setState("failed"); return; }
      // ?pool= opens that league's tournament (see LeagueProvider); Predict welcomes them in.
      window.location.replace(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/predict/?pool=${data}&welcome=1`);
    });
  }, []);

  if (state === "joining") return <p className="muted">Joining the league&hellip;</p>;
  return (
    <div className="card narrow">
      <h2>{state === "failed" ? "That league link doesn't work" : "You're already on Scrumline"}</h2>
      <p className="sub">{state === "failed" ? "The league may have a new code. Ask whoever sent it for a fresh link." : "Share your own invite link from the Leagues screen to bring mates in."}</p>
      <Link className="btn" href="/pools/">Go to Leagues</Link>
    </div>
  );
}
