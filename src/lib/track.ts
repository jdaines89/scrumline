import { supabase } from "@/lib/supabase";

export type Visit = "open" | "predict" | "leaderboard" | "chat" | "pools" | "fixtures";

const GAP = 30 * 60 * 1000;

/** Logs an app open or page view for retention numbers, at most once per half hour per kind. */
export function track(kind: Visit) {
  const key = `sl:track:${kind}`;
  try {
    const last = Number(localStorage.getItem(key) ?? 0);
    if (Date.now() - last < GAP) return;
    localStorage.setItem(key, String(Date.now()));
  } catch { /* no storage: log anyway */ }
  void supabase.rpc("track", { p_kind: kind }).then(() => undefined, () => undefined);
}

export function pageKind(path: string): Visit | null {
  const k = path.split("/").filter(Boolean)[0];
  // The Leagues screen moved from /pools/ to /leagues/; it still logs as "pools" so the numbers stay continuous.
  if (k === "leagues") return "pools";
  return k === "predict" || k === "leaderboard" || k === "chat" || k === "pools" || k === "fixtures" ? k : null;
}
