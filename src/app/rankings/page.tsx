"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EveryoneTable } from "@/components/everyone-table";
import { useLeague } from "@/components/league";
import { ProvinceTable } from "@/components/province-table";
import { SchoolSearch } from "@/components/school-search";
import { SchoolTable } from "@/components/school-table";
import { Tabs } from "@/components/tabs";
import { schoolHref } from "@/lib/crest";

type View = "everyone" | "schools" | "provinces";

/** Everyone, the schools and the provinces for this tournament. No league needed to look. */
export default function RankingsPage() {
  const { season } = useLeague();
  const router = useRouter();
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
      <p className="small" style={{ margin: "0 0 10px" }}><Link href="/feed/">See the good happening at schools ›</Link></p>
      <div className="stack" style={{ marginBottom: 12 }}>
        <SchoolSearch onPick={(s) => router.push(schoolHref(s.emis))} placeholder="Find any school by name" />
      </div>
      <Tabs label="Rankings" items={[["schools", "Schools"], ["provinces", "Provinces"], ["everyone", "Everyone"]] as const} value={view} onPick={setView} />
      <div className="view-area">
        {view === "schools" ? <SchoolTable /> : view === "provinces" ? <ProvinceTable /> : <EveryoneTable />}
      </div>
    </div>
  );
}
