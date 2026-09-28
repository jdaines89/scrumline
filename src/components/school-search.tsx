"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { School } from "@/lib/types";

/** Find any school, high or primary, by its name or a nickname. */
export function SchoolSearch({ onPick, placeholder = "Find your school by name" }: { onPick: (s: School) => void; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<School[]>([]);

  useEffect(() => {
    const text = q.trim();
    if (text.replace(/\s/g, "").length < 3) { setHits([]); return; }
    let live = true;
    const t = setTimeout(async () => {
      const [high, primary] = await Promise.all(["high", "primary"].map((p_stage) => supabase.rpc("search_schools", { p_query: text, p_stage })));
      const seen = new Set<string>();
      const all = [...(high.data ?? []), ...(primary.data ?? [])].filter((s: School) => !seen.has(s.emis) && seen.add(s.emis)) as School[];
      if (live) setHits(all.slice(0, 8));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  return (
    <>
      <input className="wide" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
      {hits.length > 0 && (
        <ul className="school-hits">
          {hits.map((s) => (
            <li key={s.emis}>
              <button type="button" onClick={() => { onPick(s); setQ(""); setHits([]); }}>
                <span>{s.name}</span><span className="small muted">{s.town}{s.no_fee ? " · no-fee" : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
