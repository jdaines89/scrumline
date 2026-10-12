"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EveryoneTable } from "@/components/everyone-table";
import { useLeague } from "@/components/league";
import { ProvinceTable } from "@/components/province-table";
import { SchoolTable } from "@/components/school-table";

type View = "everyone" | "schools" | "provinces";

/** Everyone, the schools and the provinces for this tournament. No league needed to look. */
export default function RankingsPage() {
  const { season } = useLeague();
  const [view, setView] = useState<View>("schools");
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab === "everyone" || tab === "schools" || tab === "provinces") setView(tab);
  }, []);
  return (
    <div className="card">
      <Link href="/leagues/" className="lg-back">‹ Your leagues</Link>
      <h2>Rankings</h2>
      <p className="sub">Everyone playing {season.name}, whether or not you share a league.</p>
      <div className="seg" role="tablist">
        {([["schools", "Schools"], ["provinces", "Provinces"], ["everyone", "Everyone"]] as const).map(([v, label]) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? "on" : ""} onClick={() => setView(v)}>{label}</button>
        ))}
      </div>
      {view === "schools" ? <SchoolTable /> : view === "provinces" ? <ProvinceTable /> : <EveryoneTable />}
    </div>
  );
}
