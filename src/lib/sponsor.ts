import { supabase } from "./supabase";

const SYMBOL: Record<string, string> = { ZAR: "R", INR: "₹" };

/** Minor units (cents, paise) to "R3,500" or "R3,500.50". */
export function money(minor: number, currency = "ZAR"): string {
  const whole = Math.floor(minor / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = minor % 100;
  return `${SYMBOL[currency] ?? currency + " "}${whole}${cents ? "." + String(cents).padStart(2, "0") : ""}`;
}

/** The published split, worked out the same way the database does. */
export function split(price: number) {
  const part = Math.floor((price * 20) / 100);
  return { own: part, partner: part, prizes: part, scrumline: price - 3 * part };
}

/** Up to three letters for the sponsor's tile until logos are uploaded. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.map((w) => w[0]).join("") : name.slice(0, 3)).slice(0, 3).toUpperCase();
}

export const CATEGORIES: [string, string][] = [
  ["motoring", "Motoring"], ["food_drink", "Food and drink"], ["health", "Health and fitness"],
  ["retail", "Retail"], ["services", "Professional services"], ["property", "Property"],
  ["finance", "Finance and insurance"], ["telecoms", "Telecoms and tech"], ["education", "Education"],
  ["sport", "Sport"], ["other", "Something else"],
];

/** Counts a view once a day per device (the database also dedupes per player), and taps/shares every time. */
export function sponsorEvent(booking: number, kind: "seen" | "tap" | "share") {
  if (kind === "seen") {
    const key = `sl:seen:${booking}:${new Date().toISOString().slice(0, 10)}`;
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, "1"); } catch { /* private mode: the database still dedupes */ }
  }
  supabase.rpc("sponsor_event", { p_booking: booking, p_kind: kind }).then(() => undefined);
}

export function query(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

export interface PoolSponsor {
  booking_id: number; round: number | null; display_name: string; logo_path: string | null; offer: string | null; link: string | null; prize_text: string | null;
  about: string | null; website: string | null;
}

/** A business's logo, from the public logo bucket. */
export function logoUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}/storage/v1/object/public/sponsor-logos/${path}`;
}

/** "https://www.vanzyl.co.za/deals" to "vanzyl.co.za", for showing a link. */
export function siteName(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "");
}
