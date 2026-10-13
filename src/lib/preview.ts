"use client";

import { useEffect, useState } from "react";
import type { Dashboard, Payout } from "./school";
import type { PoolPrize } from "./prizes";
import type { MyReward } from "./rewards";
import type { PoolSponsor } from "./sponsor";
import type { SeasonSponsor } from "./tournament-sponsor";

// Trial sponsors: made-up businesses that fill the sponsor features so
// players can see the app as it will look once real businesses pay. It only
// changes what each phone draws. Nothing is written to the database, no money
// moves, every trial business is marked "Trial", and their ids are negative
// so nothing is ever counted against a real booking.
//
// TRIAL_SPONSORS is the one switch: true shows them to every player (each can
// turn them off on Profile); false removes them for everyone.
export const TRIAL_SPONSORS = true;

const KEY = "sl:preview";
const EVENT = "sl-preview";

export function previewOn(): boolean {
  try {
    return TRIAL_SPONSORS && localStorage.getItem(KEY) !== "0";
  } catch { return false; }
}

export function setPreview(on: boolean) {
  try { if (on) localStorage.removeItem(KEY); else localStorage.setItem(KEY, "0"); } catch { /* no storage */ }
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

const ABOUT = "A made-up car dealer for the Scrumline trial. Service, parts and pre-owned cars.";

export function sampleSponsor(): PoolSponsor {
  return { booking_id: SAMPLE_BOOKING, round: null, display_name: "Front Row Motors", logo_path: null,
    offer: "Old boys and girls: 15% off your next service", link: null, prize_text: "Car wash voucher",
    about: ABOUT, website: null };
}

export const SAMPLE_GIVING = {
  totals: { committed_minor: 1840000, paid_minor: 1260000, confirmed_minor: 980000, schools: 6, sponsors: 4 },
  schools: [
    { emis: "s1", name: "Paul Roos Gymnasium", town: "Stellenbosch", no_fee: false, committed_minor: 330000, paid_minor: 330000, confirmed_minor: 330000, sponsors: ["Lineout Physio", "Front Row Motors"] },
    { emis: "s2", name: "Kayamandi Secondary School", town: "Stellenbosch", no_fee: true, committed_minor: 330000, paid_minor: 330000, confirmed_minor: 190000, sponsors: ["Lineout Physio", "Front Row Motors"] },
    { emis: "s3", name: "Grey High School", town: "Gqeberha", no_fee: false, committed_minor: 260000, paid_minor: 130000, confirmed_minor: null, sponsors: ["Scrumcap Optometrists"] },
    { emis: "s4", name: "Sophakama High School", town: "Gqeberha", no_fee: true, committed_minor: 260000, paid_minor: 130000, confirmed_minor: null, sponsors: ["Scrumcap Optometrists"] },
    { emis: "s5", name: "Hoërskool Stellenberg", town: "Bellville", no_fee: false, committed_minor: 140000, paid_minor: null, confirmed_minor: null, sponsors: ["Touchline Coffee"] },
    { emis: "s6", name: "Bellville High School", town: "Bellville", no_fee: true, committed_minor: 140000, paid_minor: null, confirmed_minor: null, sponsors: ["Touchline Coffee"] },
  ],
  sponsors: [
    { sponsor: "Front Row Motors", category: "motoring", to_schools_minor: 520000, schools: 2, logo_path: null, about: ABOUT, website: "https://example.com" },
    { sponsor: "Scrumcap Optometrists", category: "health", to_schools_minor: 520000, schools: 2, logo_path: null, about: "Made-up optometrists for the Scrumline trial. Eye tests, frames and contact lenses.", website: null },
    { sponsor: "Lineout Physio", category: "health", to_schools_minor: 520000, schools: 2, logo_path: null, about: "Made-up sports physio for the Scrumline trial.", website: null },
    { sponsor: "Touchline Coffee", category: "food_drink", to_schools_minor: 280000, schools: 2, logo_path: null, about: null, website: null },
  ],
};

export const SAMPLE_MINE = { booking_id: SAMPLE_BOOKING, sponsor_name: "Front Row Motors", pool_name: "Paul Roos Gymnasium Class of 2017",
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
  sponsors: ["Touchline Coffee", "Lineout Physio", "Front Row Motors"], claim_status: "verified", review_reason: null,
  notice_until: "2026-09-01T00:00:00Z", bank_name: "FNB", account_last4: "4417", account_name: "Paul Roos Gimnasium SGB",
};

export const SAMPLE_PAYOUTS: Payout[] = [
  { id: -3, amount_minor: 420000, currency: "ZAR", status: "paid", created_at: "2026-10-01T06:00:00Z", paid_at: "2026-10-01T09:12:00Z", confirmed_at: null, note: null },
  { id: -2, amount_minor: 560000, currency: "ZAR", status: "confirmed", created_at: "2026-09-01T06:00:00Z", paid_at: "2026-09-01T08:40:00Z", confirmed_at: "2026-09-02T07:15:00Z", note: null },
  { id: -1, amount_minor: 400000, currency: "ZAR", status: "confirmed", created_at: "2026-08-01T06:00:00Z", paid_at: "2026-08-01T08:05:00Z", confirmed_at: "2026-08-01T12:30:00Z", note: null },
];

/** Trial businesses all have negative ids; this marks one on screen. */
export const isTrial = (id: number | null | undefined) => typeof id === "number" && id < 0;

/** Who "offered" the trial round prize: nobody real. */
export const TRIAL_OFFERER = "trial";

/** The tournament's trial backer: "Presented by". */
export function trialSeasonSponsor(): SeasonSponsor {
  return { id: -2, round: null, display_name: "Touchline Coffee", logo_path: null,
    offer: "Show your Scrumline team at the counter: second coffee free on match days", link: null,
    about: "A made-up coffee shop for the Scrumline trial.", website: null };
}

// Trial round prizes from the made-up businesses. Each tournament and round
// picks its own, so the same prize doesn't show everywhere at once.
const TRIAL_PRIZES = [
  { sponsor: "Lineout Physio", prize: "Free sports massage", about: "A made-up sports physio for the Scrumline trial.",
    details: "Top scorer in this league for the round wins a 45-minute sports massage." },
  { sponsor: "Front Row Motors", prize: "Car wash and valet", about: ABOUT,
    details: "Top scorer in this league for the round wins a full car wash and valet." },
  { sponsor: "Touchline Coffee", prize: "Match-day breakfast for two", about: "A made-up coffee shop for the Scrumline trial.",
    details: "Top scorer in this league for the round wins breakfast for two on a match day." },
  { sponsor: "Scrumcap Optometrists", prize: "Free eye test", about: "Made-up optometrists for the Scrumline trial. Eye tests, frames and contact lenses.",
    details: "Top scorer in this league for the round wins a free eye test." },
];

function pick(seasonId: string, round: number) {
  let h = round;
  for (const c of seasonId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TRIAL_PRIZES[h % TRIAL_PRIZES.length];
}

/** A trial round prize for the round in play, only when the league has none of its own. */
export function withTrialPrize(prizes: PoolPrize[], seasonId: string, round: number | null, on: boolean): PoolPrize[] {
  if (!on || round === null || prizes.some((p) => p.round === round)) return prizes;
  const t = pick(seasonId, round);
  return [...prizes, { round, sponsor: t.sponsor, prize: t.prize, offered_by: TRIAL_OFFERER,
    status: "upcoming", winners: null, received: [], due_at: null, image_path: null,
    details: `${t.details} Trial prize: nobody really wins it.`,
    sponsor_about: t.about, sponsor_website: null, sponsor_logo: null, edit_until: null }];
}

/** The school meter's trial project, when a school has nothing real yet. */
export const TRIAL_PROJECT = { id: -1, title: "15 match balls and a kit bag", state: "open" as const,
  target_minor: 1200000, pledged_minor: 840000, paid_minor: 0, backers: 3 };

/** Trial badge rewards on Achievements, only while the tournament has no real ones. Codes are never real. */
export function trialRewards(earned: (key: string) => boolean, claimed: string[]): MyReward[] {
  const terms = "Trial reward: the business and code are made up, so there is nothing to collect.";
  return [
    { campaign_id: -1, title: "Free coffee", sponsor_name: "Touchline Coffee", achievement_key: "sharpshooter", code: "TRIAL-COFFEE",
      sponsor_about: "A made-up coffee shop for the Scrumline trial. Flat whites, rusks and the game on the big screen." },
    { campaign_id: -2, title: "R200 off a service", sponsor_name: "Front Row Motors", achievement_key: "clean-sweep", code: "TRIAL-SERVICE",
      sponsor_about: ABOUT },
    { campaign_id: -3, title: "Free eye test", sponsor_name: "Scrumcap Optometrists", achievement_key: "banker-bang", code: "TRIAL-EYES",
      sponsor_about: "Made-up optometrists for the Scrumline trial. Eye tests, frames and contact lenses." },
  ].map((r) => {
    const done = claimed.includes(r.achievement_key);
    return { ...r, sponsor_logo: null, sponsor_website: null, terms, ends_at: null, remaining: 25, earned: earned(r.achievement_key), claimed: done, code: done ? r.code : null };
  });
}
