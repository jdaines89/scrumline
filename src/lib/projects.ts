import { useCallback, useEffect, useState } from "react";
import { readCache, writeCache } from "@/lib/cache";
import { supabase } from "@/lib/supabase";

export type ProjectState = "open" | "funded" | "missed" | "ordered" | "delivered" | "cancelled";

export interface Backer { id: number; name: string; business: boolean; amount_minor: number; status: "pledged" | "paid" | "lapsed"; mine: boolean }
export interface Evidence { kind: "quote" | "order" | "delivery" | "note"; note: string | null; image_path: string | null; at: string }

/** One thing a school needs at a fixed price, with its backers and its proof. */
export interface Project {
  id: number; emis: string; school: string; town: string | null; no_fee: boolean;
  title: string; why: string; items: string; supplier: string;
  target_minor: number; currency: string; deadline: string; state: ProjectState;
  pledged_minor: number; paid_minor: number; funded_once: boolean; my_school: boolean;
  backers: Backer[]; evidence: Evidence[];
}

export const STATE_LABEL: Record<ProjectState, string> = {
  open: "Open", funded: "Fully backed", missed: "Closed", ordered: "Ordered", delivered: "Delivered", cancelled: "Cancelled",
};

/** Every project, last visit's copy first. */
export function useProjects(): [Project[] | null, () => void] {
  const key = "projects1";
  const [projects, setProjects] = useState<Project[] | null>(() => readCache<Project[]>(key) ?? null);
  const load = useCallback(() => {
    supabase.rpc("school_projects_list").then(({ data, error }) => {
      if (error) return;
      const rows = (data ?? []) as Project[];
      writeCache(key, rows); setProjects(rows);
    });
  }, []);
  useEffect(() => { load(); }, [load]);
  return [projects, load];
}

// Project photos can show learners, so they're private: a signed link, reused until near its end.
const links = new Map<string, { url: string; until: number }>();

export async function projectPhotoUrl(path: string): Promise<string | null> {
  const hit = links.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  const { data } = await supabase.storage.from("project-photos").createSignedUrl(path, 3600);
  if (!data?.signedUrl) return null;
  links.set(path, { url: data.signedUrl, until: Date.now() + 50 * 60_000 });
  return data.signedUrl;
}

/** "R1,500" typed as rands, to cents; null when it isn't a whole amount. */
export function randsToMinor(text: string): number | null {
  const n = Number(text.replace(/[R\s,]/gi, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}
