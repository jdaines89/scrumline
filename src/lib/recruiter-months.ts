// Plain helpers for recruiter prizes, kept apart from the data hooks so tests can load them.

/** "October", from a YYYY-MM-01 date. */
export function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleString("en-ZA", { month: "long", timeZone: "UTC" });
}

/** This month and next as YYYY-MM-01, in South African time. */
export function offerMonths(now = new Date()): [string, string] {
  const sast = new Date(now.getTime() + 2 * 3600 * 1000);
  const y = sast.getUTCFullYear(), m = sast.getUTCMonth();
  const fmt = (yy: number, mm: number) => `${yy + Math.floor(mm / 12)}-${String((mm % 12) + 1).padStart(2, "0")}-01`;
  return [fmt(y, m), fmt(y, m + 1)];
}

/** "Andy and Christo", or "Andy, Christo and 3 more". */
export function names(ids: string[], nameOf: (id: string) => string): string {
  const n = ids.map(nameOf);
  return n.length <= 2 ? n.join(" and ") : `${n.slice(0, 2).join(", ")} and ${n.length - 2} more`;
}
