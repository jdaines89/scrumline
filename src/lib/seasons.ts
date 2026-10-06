import type { Season } from "@/lib/types";

/**
 * Which tournament to open on a device that hasn't picked one: the newest
 * being played now (or starting within a week), else the newest live one,
 * else the newest. Seasons arrive newest first.
 */
export function defaultSeason(seasons: Season[], now = new Date()): Season {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const today = day(now);
  const soon = day(new Date(now.getTime() + 7 * 86400000));
  const running = seasons.filter((s) => !s.is_replay && (!s.starts_on || s.starts_on <= soon) && (!s.ends_on || s.ends_on >= today));
  return running[0] ?? seasons.find((s) => !s.is_replay) ?? seasons[0];
}

/** The next match in another tournament. */
export interface NextUp { season: string; round: number; kickoff_at: string }

/**
 * Whether to point at another tournament: its next round starts within eight
 * days and before anything in the one you're looking at (the URC break).
 */
export function worthSwitching(currentNext: string | null, other: NextUp | null, now = Date.now()): boolean {
  if (!other) return false;
  const t = Date.parse(other.kickoff_at);
  if (t - now > 8 * 864e5) return false;
  return currentNext === null || t < Date.parse(currentNext);
}

/** One heading in the tournament picker and the tournaments under it. */
export interface PickerGroup { label: string; seasons: Season[] }

/**
 * The tournament picker, kept short as tournaments come and go: what's on
 * now, what's coming up (soonest first), what finished in the last year
 * (newest first), then practice replays. Anything older drops out of the
 * list (its leagues and points stay); the one you're on always shows.
 */
export function pickerGroups(seasons: Season[], currentId: string, now = new Date()): PickerGroup[] {
  const today = now.toISOString().slice(0, 10);
  const yearAgo = new Date(now.getTime() - 365 * 86400000).toISOString().slice(0, 10);
  const live = seasons.filter((s) => !s.is_replay);
  const on = live.filter((s) => (!s.starts_on || s.starts_on <= today) && (!s.ends_on || s.ends_on >= today));
  const soon = live.filter((s) => s.starts_on && s.starts_on > today)
    .sort((a, b) => a.starts_on!.localeCompare(b.starts_on!));
  const done = live.filter((s) => s.ends_on && s.ends_on < today && (s.ends_on >= yearAgo || s.id === currentId))
    .sort((a, b) => b.ends_on!.localeCompare(a.ends_on!));
  const practice = seasons.filter((s) => s.is_replay);
  return [
    { label: "On now", seasons: on },
    { label: "Coming up", seasons: soon },
    { label: "Finished", seasons: done },
    { label: "Practice", seasons: practice },
  ].filter((g) => g.seasons.length > 0);
}
