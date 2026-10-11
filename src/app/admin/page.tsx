"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Numbers } from "@/components/numbers";
import { useLeague } from "@/components/league";
import { supabase } from "@/lib/supabase";

/** Running Scrumline: every admin tool and the numbers, on their own page. Admins only. */
export default function AdminHome() {
  const { me, season } = useLeague();
  const [held, setHeld] = useState<number | null>(null);
  useEffect(() => {
    if (me.is_admin) supabase.rpc("mod_waiting").then(({ data }) => setHeld((data as number | null) ?? 0));
  }, [me.is_admin]);

  if (!me.is_admin) return <div className="card narrow"><h2>Admins only</h2></div>;

  return (
    <div className="mepage">
      <div className="card">
        <p className="sp-kicker">Admin</p>
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
      <Numbers season={season.id} seasonName={season.name} />
    </div>
  );
}
