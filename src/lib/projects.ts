import { useCallback, useEffect, useState } from "react";
import { readCache, writeCache } from "@/lib/cache";
import { supabase } from "@/lib/supabase";

export type ProjectState = "open" | "funded" | "missed" | "ordered" | "delivered" | "cancelled";

export interface Backer { id: number; name: string; business: boolean; amount_minor: number; status: "pledged" | "paid" | "lapsed"; mine: boolean }
export interface NeedPhoto { project_id: number; image_path: string; caption: string | null; at: string }
export interface Evidence { kind: "quote" | "order" | "delivery" | "note"; note: string | null; image_path: string | null; at: string }

/** One thing a school needs at a fixed price, with its backers and its proof. */
export interface Project {
  id: number; emis: string; school: string; town: string | null; no_fee: boolean;
  title: string; why: string; items: string; supplier: string;
  price_minor: number; fee_minor: number; fee_bps: number; target_minor: number; currency: string; deadline: string; state: ProjectState;
  pledged_minor: number; paid_minor: number; funded_once: boolean; my_school: boolean;
  backers: Backer[]; evidence: Evidence[];
  /** Photos taken when it was listed, showing why it's needed. */
  need?: NeedPhoto[];
}

export const STATE_LABEL: Record<ProjectState, string> = {
  open: "Open", funded: "Fully backed", missed: "Closed", ordered: "Ordered", delivered: "Delivered", cancelled: "Cancelled",
};

/** Every project, last visit's copy first. */
export function useProjects(): [Project[] | null, () => void] {
  const key = "projects2";
  const [projects, setProjects] = useState<Project[] | null>(() => readCache<Project[]>(key) ?? null);
  const load = useCallback(() => {
    Promise.all([supabase.rpc("school_projects_list"), supabase.rpc("project_need_photos_list")]).then(([list, photos]) => {
      if (list.error) return;
      const need = (photos.data ?? []) as NeedPhoto[];
      const rows = ((list.data ?? []) as Project[]).map((p) => ({ ...p, need: need.filter((n) => n.project_id === p.id) }));
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

/**
 * Ready-made projects: things that are bought, delivered and photographed,
 * never building work. Picking one fills in the form; the price always comes
 * from a real supplier's quote.
 */
export const PROJECT_MENU: { title: string; why: string; items: string }[] = [
  { title: "Match balls for the team", why: "The balls we train and play with are worn smooth and some won't hold air.", items: "20 size-5 rugby match and training balls, with a ball bag" },
  { title: "Kit for the first team", why: "Players share old jerseys that don't fit, and some play in their own T-shirts.", items: "A set of 25 jerseys, shorts and socks in the school's colours" },
  { title: "Boots for players who have none", why: "Some of our players train and play barefoot or in school shoes.", items: "Rugby boots in the sizes the coach lists, up to 20 pairs" },
  { title: "A box of reading books", why: "Our library shelves are close to empty and learners have little to read at home.", items: "A box of graded readers in English and the home language, chosen with the teachers" },
  { title: "A year of sanitary pads", why: "Girls miss school every month because they can't afford pads.", items: "A year's supply of sanitary pads for the girls in one grade, delivered each term" },
  { title: "A water tank", why: "The taps run dry during the week and learners have nothing to drink at break.", items: "A 5,000 litre water tank with stand, delivered and fitted by the supplier" },
  { title: "School shoes", why: "Learners come to school in broken shoes, or none, through winter.", items: "School shoes in the sizes the school lists, up to 40 pairs" },
  { title: "Solar lights for homework", why: "Many learners have no electricity at home and can't study after dark.", items: "40 solar study lamps, one for each learner in a grade" },
];
