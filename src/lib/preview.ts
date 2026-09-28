"use client";

import { useEffect, useState } from "react";
import type { Dashboard, Payout } from "./school";
import type { PoolSponsor } from "./sponsor";

// Sample-data preview: lets an admin see the sponsor features filled in
// before any business has paid. It only changes what this phone draws; it
// never writes anything, and nobody else sees it.

const KEY = "sl:preview";
const EVENT = "sl-preview";

export function previewOn(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

export function setPreview(on: boolean) {
  try { if (on) localStorage.setItem(KEY, "1"); else localStorage.removeItem(KEY); } catch { /* no storage */ }
  window.dispatchEvent(new Event(EVENT));
}

export function usePreview(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const read = () => setOn(previewOn());
    read();
    window.addEventListener(EVENT, read);
    return () => window.removeEventListener(EVENT, read);
  }, []);
  return on;
}

/** Sample bookings use negative ids, so nothing is ever counted against a real one. */
export const SAMPLE_BOOKING = -1;

const ABOUT = "Family-owned Toyota and VW dealer in Stellenbosch since 1987. Service, parts and pre-owned cars.";

export function sampleSponsor(): PoolSponsor {
  return { booking_id: SAMPLE_BOOKING, round: null, display_name: "Van Zyl Motors", logo_path: null,
    offer: "Old boys and girls: 15% off your next service", link: "https://example.com", prize_text: "Car wash voucher",
    about: ABOUT, website: "https://example.com" };
}

export const SAMPLE_GIVING = {
  totals: { committed_minor: 1840000, paid_minor: 1260000, confirmed_minor: 980000, schools: 6, sponsors: 4 },
  schools: [
    { emis: "s1", name: "Paul Roos Gymnasium", town: "Stellenbosch", no_fee: false, committed_minor: 330000, paid_minor: 330000, confirmed_minor: 330000, sponsors: ["Stellenbosch Physio", "Van Zyl Motors"] },
    { emis: "s2", name: "Kayamandi Secondary School", town: "Stellenbosch", no_fee: true, committed_minor: 330000, paid_minor: 330000, confirmed_minor: 190000, sponsors: ["Stellenbosch Physio", "Van Zyl Motors"] },
    { emis: "s3", name: "Grey High School", town: "Gqeberha", no_fee: false, committed_minor: 260000, paid_minor: 130000, confirmed_minor: null, sponsors: ["Specs Corner"] },
    { emis: "s4", name: "Sophakama High School", town: "Gqeberha", no_fee: true, committed_minor: 260000, paid_minor: 130000, confirmed_minor: null, sponsors: ["Specs Corner"] },
    { emis: "s5", name: "Hoërskool Stellenberg", town: "Bellville", no_fee: false, committed_minor: 140000, paid_minor: null, confirmed_minor: null, sponsors: ["Die Bank Coffee"] },
    { emis: "s6", name: "Bellville High School", town: "Bellville", no_fee: true, committed_minor: 140000, paid_minor: null, confirmed_minor: null, sponsors: ["Die Bank Coffee"] },
  ],
  sponsors: [
    { sponsor: "Van Zyl Motors", category: "motoring", to_schools_minor: 520000, schools: 2, logo_path: null, about: ABOUT, website: "https://example.com" },
    { sponsor: "Specs Corner", category: "health", to_schools_minor: 520000, schools: 2, logo_path: null, about: "Independent optometrists in Gqeberha. Eye tests, frames and contact lenses.", website: null },
    { sponsor: "Stellenbosch Physio", category: "health", to_schools_minor: 520000, schools: 2, logo_path: null, about: null, website: null },
    { sponsor: "Die Bank Coffee", category: "food_drink", to_schools_minor: 280000, schools: 2, logo_path: null, about: null, website: null },
  ],
};

export const SAMPLE_MINE = { booking_id: SAMPLE_BOOKING, sponsor_name: "Van Zyl Motors", pool_name: "Paul Roos Gymnasium Class of 2017",
  season_name: "URC 2026-27", round: null, status: "live", price_minor: 350000, currency: "ZAR", creative_status: "approved" };

export const SAMPLE_RESULTS = { players: 42, reached: 39, seen: 1284, shares: 61, taps: 23 };

export const SAMPLE_ALLOC = [
  { school: "Paul Roos Gymnasium", share: "own", amount_minor: 70000, currency: "ZAR", status: "confirmed" },
  { school: "Kayamandi Secondary School", share: "partner", amount_minor: 70000, currency: "ZAR", status: "paid" },
];

export function sampleDays(): { day: string; seen: number }[] {
  const weeks = [140, 190, 215, 180, 255, 304];
  return weeks.map((seen, i) => ({ day: new Date(Date.now() - (5 - i) * 7 * 864e5 - 864e5).toISOString().slice(0, 10), seen }));
}

/** A claimed school's page, filled in. */
export const SAMPLE_DASHBOARD: Dashboard = {
  emis: "sample", name: "Paul Roos Gymnasium", town: "Stellenbosch", no_fee: false,
  partner_name: "Kayamandi Secondary School", partner_town: "Stellenbosch", players: 184,
  raised_minor: 1660000, paid_minor: 1380000, confirmed_minor: 960000, waiting_minor: 280000,
  sponsors: ["Die Bank Coffee", "Stellenbosch Physio", "Van Zyl Motors"], claim_status: "verified", review_reason: null,
  notice_until: "2026-09-01T00:00:00Z", bank_name: "FNB", account_last4: "4417", account_name: "Paul Roos Gimnasium SGB",
};

export const SAMPLE_PAYOUTS: Payout[] = [
  { id: -3, amount_minor: 420000, currency: "ZAR", status: "paid", created_at: "2026-10-01T06:00:00Z", paid_at: "2026-10-01T09:12:00Z", confirmed_at: null, note: null },
  { id: -2, amount_minor: 560000, currency: "ZAR", status: "confirmed", created_at: "2026-09-01T06:00:00Z", paid_at: "2026-09-01T08:40:00Z", confirmed_at: "2026-09-02T07:15:00Z", note: null },
  { id: -1, amount_minor: 400000, currency: "ZAR", status: "confirmed", created_at: "2026-08-01T06:00:00Z", paid_at: "2026-08-01T08:05:00Z", confirmed_at: "2026-08-01T12:30:00Z", note: null },
];
