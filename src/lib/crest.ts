/**
 * A school's own shield until it adds its real crest: two colours and a
 * simple heraldic division, picked from its EMIS number so the same school
 * always gets the same shield. Never letters: a school's name is never
 * shortened, not even to initials.
 */

/** Pairs a school might wear: a field colour and a metal. */
const COLOURS: [string, string][] = [
  ["#1f3a6b", "#e0b23c"], // navy and gold
  ["#6b1f2a", "#f2efe6"], // maroon and white
  ["#1d5a3a", "#e0b23c"], // bottle green and gold
  ["#24508f", "#f2efe6"], // royal blue and white
  ["#1c1c1c", "#e0b23c"], // black and gold
  ["#8f2424", "#f2efe6"], // red and white
  ["#4a2a6b", "#e0b23c"], // purple and gold
  ["#0f5c63", "#f2efe6"], // teal and white
  ["#5a3a1d", "#e8d9b0"], // brown and cream
  ["#2e3d4f", "#c9d4de"], // slate and silver
];

export type Division = "chevron" | "pale" | "bend" | "quarterly" | "fess" | "saltire";
const DIVISIONS: Division[] = ["chevron", "pale", "bend", "quarterly", "fess", "saltire"];

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

export interface Shield { field: string; metal: string; division: Division }

export function shieldFor(emis: string): Shield {
  const h = hash(emis);
  const [field, metal] = COLOURS[h % COLOURS.length];
  return { field, metal, division: DIVISIONS[Math.floor(h / COLOURS.length) % DIVISIONS.length] };
}

/** "Primary school", "High school" or "Combined school", from what it offers. */
export function schoolKind(s: { offers_primary: boolean; offers_matric: boolean }): string {
  if (s.offers_primary && s.offers_matric) return "Combined school";
  if (s.offers_matric) return "High school";
  return "Primary school";
}

/** Where a school's page lives. */
export const schoolHref = (emis: string) => `/school-page/?e=${encodeURIComponent(emis)}`;

const PROVINCES: Record<string, string> = {
  EC: "Eastern Cape", FS: "Free State", GP: "Gauteng", KZN: "KwaZulu-Natal", LP: "Limpopo",
  MP: "Mpumalanga", NC: "Northern Cape", NW: "North West", WC: "Western Cape",
};

/** The school list stores provinces as codes; people read the full name. */
export const provinceName = (code: string) => PROVINCES[code] ?? code;
