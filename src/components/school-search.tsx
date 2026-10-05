"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { School } from "@/lib/types";

/**
 * Find any school, high or primary, by its name or a nickname. Signed out
 * (the For schools page) it uses the public search, which returns only the
 * government list's name, town and number.
 */
export function SchoolSearch({ onPick, placeholder = "Find your school by name", signedOut = false }: {
  onPick: (s: School) => void; placeholder?: string; signedOut?: boolean;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<School[]>([]);

  useEffect(() => {
    const text = q.trim();
    if (text.replace(/\s/g, "").length < 3) { setHits([]); return; }
    let live = true;
    const t = setTimeout(async () => {
      if (signedOut) {
        const { data } = await supabase.rpc("find_school", { p_query: text });
        if (live) setHits((data ?? []) as School[]);
        return;
      }
      const [high, primary] = await Promise.all(["high", "primary"].map((p_stage) => supabase.rpc("search_schools", { p_query: text, p_stage })));
      const seen = new Set<string>();
      const all = [...(high.data ?? []), ...(primary.data ?? [])].filter((s: School) => !seen.has(s.emis) && seen.add(s.emis)) as School[];
      if (live) setHits(all.slice(0, 8));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q, signedOut]);

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
