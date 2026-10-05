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
