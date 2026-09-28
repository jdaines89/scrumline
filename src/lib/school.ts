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
