"use client";

import { useLeague } from "@/components/league";
import { TRIAL_SPONSORS, usePreview } from "./preview";

// Trial school projects: example posts in the school feed, so the feed can be
// judged with real photos before the first real project is delivered. Real
// schools, made-up amounts and backers. Like trial sponsors, nothing is in
// the database, no money moves, ids are negative and each post is marked Trial.
//
// TRIAL_PROJECTS is the one switch: "admin" shows them only to admins, "all"
// to every player (each can hide them with the Trial sponsors switch on
// Profile), "off" removes them. To remove them for good, also delete this file,
// public/trial-projects/ and the three trial lines in school-feed.tsx.
export const TRIAL_PROJECTS: "admin" | "all" | "off" = "admin";

/** Photos ship with the app, so they are marked "static:" and never asked of storage. */
export const STATIC = "static:";

const day = 86400_000;
const ago = (d: number, h = 0) => new Date(Date.now() - d * day - h * 3600_000).toISOString();
const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
const photo = (f: string) => `${STATIC}${base}/trial-projects/${f}`;

const CLARENDON = { emis: "200100120", school: "Clarendon Park Primary School", town: "Gqeberha", province: "EC" };
const UMVUZO = { emis: "500443926", school: "Umvuzo Secondary School", town: "Pietermaritzburg", province: "KZN" };
const VICTORIA = { emis: "200100823", school: "Victoria Park High School", town: "Gqeberha", province: "EC" };

export interface TrialItem {
  project_id: number; post_key: string; at: string; event: string; emis: string; school: string; town: string | null;
  province: string; title: string; note: string | null; image_path: string | null;
  reactions: Record<string, number>; mine: string[]; comments: number; trial: true;
}

function items(): TrialItem[] {
  const post = (p: Omit<TrialItem, "mine" | "comments" | "trial">): TrialItem => ({ ...p, mine: [], comments: 0, trial: true });
  return [
    post({ ...CLARENDON, project_id: -11, post_key: "e1", at: ago(1, 3), event: "delivery", title: "A library for the Foundation Phase",
      note: "Shelves are up and 1,200 books are in. Grade 1 to 3 now have a library period every week.",
      image_path: photo("library.jpg"), reactions: { "🔥": 34, "👍": 9, "😮": 3 } }),
    post({ ...UMVUZO, project_id: -12, post_key: "e2", at: ago(4, 6), event: "delivery", title: "New toilets and basins",
      note: "Eight flush toilets and six basins with running water, replacing the old pit toilets.",
      image_path: photo("toilets-after.jpg"), reactions: { "🔥": 51, "👍": 14, "😢": 2 } }),
    post({ ...VICTORIA, project_id: -13, post_key: "e3", at: ago(9, 2), event: "delivery", title: "Water tanks on the sports field",
      note: "Three 5,000 litre tanks on stands, so the school keeps water when the taps run dry.",
      image_path: photo("water-tanks.jpg"), reactions: { "🔥": 27, "🏉": 6 } }),
    post({ ...CLARENDON, project_id: -11, post_key: "funded", at: ago(16, 4), event: "funded", title: "A library for the Foundation Phase",
      note: null, image_path: null, reactions: { "🔥": 12 } }),
    post({ ...UMVUZO, project_id: -12, post_key: "opened", at: ago(31, 5), event: "opened", title: "New toilets and basins",
      note: "This is what learners use today. Help replace them with proper toilets.",
      image_path: photo("toilets-before.jpg"), reactions: { "😢": 18, "👍": 7 } }),
  ];
}

export const TRIAL_FACTS: Record<number, { project_id: number; items: string; target_minor: number; pledged_minor: number; backers: number; learners: number | null }> = {
  [-11]: { project_id: -11, items: "1,200 books, 8 shelves, 6 tables and 36 chairs", target_minor: 8500000, pledged_minor: 8500000, backers: 7, learners: 986 },
  [-12]: { project_id: -12, items: "8 flush toilets and 6 basins", target_minor: 18000000, pledged_minor: 18000000, backers: 4, learners: 1512 },
  [-13]: { project_id: -13, items: "3 x 5,000 litre tanks with stands and pipes", target_minor: 6000000, pledged_minor: 6000000, backers: 3, learners: 1074 },
};

/** The trial posts this player should see: one school's, one province's, or all. */
export function useTrialFeed(emis?: string, province?: string): TrialItem[] {
  const { me } = useLeague();
  const preview = usePreview();
  const on = TRIAL_SPONSORS && preview && (TRIAL_PROJECTS === "all" || (TRIAL_PROJECTS === "admin" && me.is_admin));
  if (!on) return [];
  return items().filter((i) => (!emis || i.emis === emis) && (!province || i.province === province));
}
