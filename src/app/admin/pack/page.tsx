"use client";

import { useEffect, useState } from "react";
import { useLeague } from "@/components/league";
import { money } from "@/lib/sponsor";
import { supabase } from "@/lib/supabase";

interface Price { kind: "school" | "class" | "pool"; min_players: number; season: number; round: number }
interface Pack {
  as_of: string; players: number; wac: number; wac_4w: number | null; calls_30d: number; chat_30d: number;
  leagues: number; schools: number; alerts: number | null; given: number;
  tournaments: { name: string; matches: number; from: string; to: string }[] | null;
  prices: Price[];
}

const KIND: Record<Price["kind"], string> = { school: "A school's league", class: "A class (old pupils) league", pool: "A private league" };
const day = (iso: string) => new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", timeZone: "Africa/Johannesburg" });

/**
 * The sponsor pack: one page, built from live numbers, for an admin to save
 * as a PDF and send on. Nothing here is public.
 */
export default function SponsorPack() {
  const { me } = useLeague();
  const [p, setP] = useState<Pack | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!me.is_admin) return;
    supabase.rpc("sponsor_pack").then(({ data, error }) => (error || !data ? setErr(error?.message ?? "No numbers yet.") : setP(data as Pack)));
  }, [me.is_admin]);
  if (!me.is_admin) return <div className="card narrow"><h2>Admins only</h2></div>;
  if (err) return <div className="notice">{err}</div>;
  if (!p) return <p className="muted">Loading&hellip;</p>;

  const tiers = (kind: Price["kind"]) => p.prices.filter((x) => x.kind === kind);
  const range = (kind: Price["kind"]) => {
    const t = tiers(kind);
    if (!t.length) return "";
    const lo = Math.min(...t.map((x) => x.season)), hi = Math.max(...t.map((x) => x.season));
    return lo === hi ? money(lo) : `${money(lo)} to ${money(hi)}`;
  };

  return (
    <>
      <div className="row no-print pack-actions">
        <span className="small muted grow">Live numbers as of {day(p.as_of)}. Save as PDF and send it yourself.</span>
        <button type="button" onClick={() => window.print()}>Save as PDF</button>
      </div>
      <article className="pack">
        <header>
          <p className="sp-kicker">Sponsor pack</p>
          <h1>Back the rugby your customers already play</h1>
          <p className="sub">Scrumline is a free rugby prediction league for South Africans. Friends, old pupils and whole schools call the score of every URC and Test match, every week, on their phones.</p>
        </header>

        <section className="pack-stats">
          <div><b>{p.players}</b><span>players</span></div>
          <div><b>{p.wac_4w ?? p.wac}</b><span>calling every week</span></div>
          <div><b>{p.calls_30d}</b><span>score calls in 30 days</span></div>
          <div><b>{p.schools}</b><span>schools represented</span></div>
        </section>

        <section>
          <h3>What a sponsor gets</h3>
          <ul>
            <li>Your name on a league or a round: &ldquo;Round 4 sponsored by you&rdquo;, seen by every player each time they call their scores.</li>
            <li>A line in the round recap players share to their WhatsApp groups.</li>
            <li>Weekly figures: how many players saw your name and tapped through.</li>
            <li>Optionally, a prize from your business for the round winner, under published rules.</li>
          </ul>
        </section>

        <section>
          <h3>Prices for a season</h3>
          <table>
            <tbody>
              {(["school", "class", "pool"] as const).map((k) => tiers(k).length > 0 && (
                <tr key={k}><td>{KIND[k]}</td><td className="num">{range(k)}</td><td className="num muted">{money(tiers(k)[0].round)} a round</td></tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">The price grows with the league&apos;s size. One sponsor per league per season, and one per round.</p>
        </section>

        <section>
          <h3>Where the money goes</h3>
          <p>Part of every sponsorship is advertising, invoiced by Scrumline. The rest is a gift to schools: the school whose players are in the league and a no-fee partner school. Every rand is recorded in a ledger that can&apos;t be edited, and each school confirms what it received.{p.given > 0 && <> So far {money(p.given)} has been given.</>}</p>
        </section>

        {p.tournaments && p.tournaments.length > 0 && (
          <section>
            <h3>Coming up</h3>
            <ul>{p.tournaments.map((t) => <li key={t.name}>{t.name}: {t.matches} matches, {day(t.from)} to {day(t.to)}</li>)}</ul>
          </section>
        )}

        <footer className="small muted">No alcohol, betting or gambling sponsors. Players are 18 and over. Competition rules: jdaines89.github.io/scrumline/rules</footer>
      </article>
    </>
  );
}
