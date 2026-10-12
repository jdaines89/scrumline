import type { School } from "@/lib/types";

/**
 * Trial switch (temporary, 2026-10-11): while true, every schoolmate counts
 * without two vouches and one player is enough for a school's round to count.
 * Matches public.school_rules_relaxed() in the database; flip both back
 * together to bring the 2-vouch and 10-player rules back.
 */
export const SCHOOL_TRIAL = true;
/** Players a school needs in one round for that round to count. */
export const SCHOOL_MINIMUM = SCHOOL_TRIAL ? 1 : 10;
/** Players a class year needs before it is ranked against the other years. Matches public.class_ranked_minimum(). */
export const CLASS_MINIMUM = SCHOOL_TRIAL ? 1 : 3;

/** Who at a school looks after its account. */
export const ROLES: [string, string][] = [
  ["principal", "Principal"],
  ["bursar", "Bursar or finance office"],
  ["sgb", "Governing body member"],
  ["alumni", "Alumni or old pupils' office"],
];
export const ROLE_NAME: Record<string, string> = { ...Object.fromEntries(ROLES), teacher: "Teacher" };

/** South African languages a school can be looked after in. */
export const LANGUAGES: [string, string][] = [
  ["en", "English"], ["xh", "isiXhosa"], ["zu", "isiZulu"], ["af", "Afrikaans"], ["st", "Sesotho"], ["tn", "Setswana"],
  ["nso", "Sepedi"], ["ts", "Xitsonga"], ["ve", "Tshivenda"], ["ss", "siSwati"], ["nr", "isiNdebele"],
];

export interface Dashboard {
  emis: string; name: string; town: string | null; no_fee: boolean; partner_name: string | null; partner_town: string | null;
  players: number; raised_minor: number; paid_minor: number; confirmed_minor: number; waiting_minor: number;
  sponsors: string[]; claim_status: string | null; review_reason: string | null; notice_until: string | null;
  bank_name: string | null; account_last4: string | null; account_name: string | null;
}
export interface Payout { id: number; amount_minor: number; currency: string; status: string; created_at: string; paid_at: string | null; confirmed_at: string | null; note: string | null }

// The school picked on the For schools page, carried to the claim step after
// the email link so nobody searches twice. Only public list details.
const PICKED = "scrumline-claim-school";
export function rememberPickedSchool(s: School | null): void {
  try { if (s) localStorage.setItem(PICKED, JSON.stringify(s)); else localStorage.removeItem(PICKED); } catch { /* storage blocked: they search again */ }
}
export function pickedSchool(): School | null {
  try { const raw = localStorage.getItem(PICKED); return raw ? (JSON.parse(raw) as School) : null; } catch { return null; }
}
