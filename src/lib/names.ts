import { useEffect, useState } from "react";
import { readCache, writeCache } from "@/lib/cache";
import { supabase } from "@/lib/supabase";
import type { Member } from "@/lib/types";

type Named = Pick<Member, "display_name" | "first_name" | "last_name" | "known_as">;

/** The real name with the school nickname in it: Andisile "Reeves" Mndai. Falls back to the short name. */
export function fullName(m: Named | undefined | null): string {
  if (!m) return "";
  if (!m.first_name) return m.display_name;
  const nick = m.known_as && m.known_as.toLowerCase() !== m.first_name.toLowerCase() ? ` "${m.known_as}"` : "";
  return `${m.first_name}${nick}${m.last_name ? ` ${m.last_name}` : ""}`;
}

/** Whether someone still has to tell us who they are. */
export function needsNames(m: Pick<Member, "first_name" | "last_name" | "team_name">): boolean {
  return !m.first_name || !m.last_name || !m.team_name;
}

const SUGGESTIONS = [
  "Ruck 'n Roll", "Lineout Legends", "Scrum Dogs", "Maul Rats", "Knock-On Wood", "The Up & Unders",
  "Garryowen Gang", "Sin Bin Squad", "Drop Goal Dreamers", "Breakdown Boys", "Grubber Gang", "Box Kick Brigade",
  "Forward Pass FC", "The Loose Heads", "Tight Five Club", "Offside Trap", "Try Hard XV", "Sidestep Society",
  "The Blindsiders", "Hooker's Choice", "Pick & Go", "Rolling Maul", "Twenty-Two Drop", "Golden Point",
];

/** A few team names to tap, skipping any already taken. */
export function suggestTeams(taken: string[], seed: number, count = 3): string[] {
  const used = new Set(taken.map((t) => t.toLowerCase()));
  const free = SUGGESTIONS.filter((s) => !used.has(s.toLowerCase()));
  const out: string[] = [];
  for (let i = 0; i < Math.min(count, free.length); i++) out.push(free[(seed * count + i) % free.length]);
  return [...new Set(out)];
}

/** "Victoria Park High School '07": where each person played their school rugby (high school first). */
export function useSchoolLabels(): Map<string, string> {
  const [labels, setLabels] = useState<Record<string, string>>(() => readCache<Record<string, string>>("schoollabels") ?? {});
  useEffect(() => {
    supabase.from("member_schools").select("user_id, stage, last_year, schools(name)").then(({ data }) => {
      const out: Record<string, string> = {};
      const rows = (data ?? []) as unknown as { user_id: string; stage: string; last_year: number | null; schools: { name: string } | null }[];
      for (const stage of ["primary", "high"]) {
        for (const r of rows) {
          if (r.stage !== stage || !r.schools) continue;
          out[r.user_id] = r.last_year ? `${r.schools.name} '${String(r.last_year).slice(-2)}` : r.schools.name;
        }
      }
      writeCache("schoollabels", out);
      setLabels(out);
    });
  }, []);
  return new Map(Object.entries(labels));
}
