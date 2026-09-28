import type { Session } from "@supabase/supabase-js";

/** Pages anyone can open without signing in. */
export const isPublicPath = (path: string | null) => (path ?? "").startsWith("/business");

/** Pages a business account may open; everything else is for players. */
export const isSponsorPath = (path: string | null) => /^\/(sponsor|giving)/.test(path ?? "");

/**
 * Whether this account was made for a business. Only steers which screens
 * show: the database decides what a business can read, whatever this says.
 */
export const isBusinessSession = (s: Session | null | undefined) => s?.user.user_metadata?.kind === "business";
