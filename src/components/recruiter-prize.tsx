"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { useLeague } from "@/components/league";
import { PrizeDetail } from "@/components/prize-detail";
import { shrinkPhoto } from "@/lib/photo";
import { prizePhotoUrl } from "@/lib/prizes";
import { plural } from "@/lib/recruits";
import { monthName, names, offerMonths, usePoolRecruiterPrizes, type RecruiterPrize, type RecruiterStatus } from "@/lib/recruiter-prizes";
import { supabase } from "@/lib/supabase";

const STATUS: Record<RecruiterStatus, string> = {
  upcoming: "Upcoming", open: "Running", counting: "Counting", "no winner": "No winner",
  awaiting: "Awaiting", delivered: "Delivered", "not delivered": "Not delivered",
};

const RULE = "Anyone you bring in during the month counts once they've played 3 matches. It's settled a week after the month ends.";

function useNameOf() {
  const { members, me } = useLeague();
  return (id: string) => (id === me.user_id ? "you" : members.find((m) => m.user_id === id)?.display_name ?? "a player");
}

/** What the prize sheet shows; where it stands comes in as text. */
const shown_ = ({ prize, details, image_path, sponsor, sponsor_logo, sponsor_about, sponsor_website, offered_by }: RecruiterPrize) =>
  ({ prize, details, image_path, sponsor, sponsor_logo, sponsor_about, sponsor_website, offered_by });

/** Where a recruiter prize stands, in one line. */
function standing(p: RecruiterPrize, nameOf: (id: string) => string): string {
  if (p.winners?.length) return `Won by ${names(p.winners, nameOf)}${p.status === "awaiting" ? ", on its way" : ""}`;
  if (p.status === "no winner") return "Nobody brought anyone in";
  if (p.leaders?.length) {
    const who = names(p.leaders, nameOf);
    const lead = p.leaders.length > 1 || who === "you" ? "lead" : "leads";
    return `${who.charAt(0).toUpperCase()}${who.slice(1)} ${lead} with ${plural(p.best, "new player", "new players")}${p.status === "counting" ? ", still counting" : ""}`;
  }
  return p.status === "upcoming" ? `Starts in ${monthName(p.month)}` : "Nobody has brought anyone in yet";
}

/**
 * The pool's recruiter prize as one quiet panel on the leaderboard: what's up
 * for grabs this month and who's ahead, and for a winner, the button to say
 * it arrived.
 */
export function RecruiterPrizeLine({ prizes, onChange, onlyOwed = false }: {
  prizes: RecruiterPrize[]; onChange: () => void;
  /** When a round prize already has the panel: only a winner's "Received" row, nothing else. */
  onlyOwed?: boolean;
}) {
  const { me, pool } = useLeague();
  const nameOf = useNameOf();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<RecruiterPrize | null>(null);
  const shown = onlyOwed ? undefined : prizes.find((p) => p.status === "open") ?? prizes.find((p) => p.status === "counting");
  const owed = prizes.find((p) => p.status === "awaiting" && p.winners?.includes(me.user_id) && !p.received.includes(me.user_id));
  if (!shown && !owed) return null;

  async function received(p: RecruiterPrize) {
    setBusy(true);
    await supabase.from("recruiter_prize_receipts").insert({ pool_id: pool!.id, month: p.month });
    setBusy(false);
    onChange();
  }

  return (
    <div className="prize prize-quiet">
      {shown && (
        <div className="prize-row">
          <button type="button" className="prize-open" aria-haspopup="dialog" onClick={() => setOpen(shown)}>
            {shown.image_path && <img className="prize-thumb" src={prizePhotoUrl(shown.image_path)} alt={shown.prize} />}
            <div className="prize-text">
              <span className="prize-label">{monthName(shown.month)} recruiter prize</span>
              <strong>{shown.prize}</strong>
              <span className="prize-meta">{shown.sponsor} · {standing(shown, nameOf)}</span>
            </div>
            <span className="prize-more" aria-hidden="true">›</span>
          </button>
        </div>
      )}
      {owed && (
        <div className="prize-row">
          <div className="prize-text" onClick={() => setOpen(owed)} style={{ cursor: "pointer" }}>
            <span className="prize-label">Top recruiter in {monthName(owed.month)}</span>
            <strong>{owed.prize}</strong>
            <span className="prize-meta">Tap once {owed.sponsor} has handed it over</span>
          </div>
          <button type="button" className="ghost prize-btn" disabled={busy} onClick={() => received(owed)}>Received</button>
        </div>
      )}
      {open && (
        <PrizeDetail prize={shown_(open)} nameOf={nameOf} onClose={() => setOpen(null)}
          label={`${monthName(open.month)} recruiter prize`} state={`${standing(open, nameOf)}. ${RULE}`} />
      )}
    </div>
  );
}

interface Business { id: number; name: string }

/**
 * For a pool member who runs a business on Scrumline: put up a prize for
 * the pool's top recruiter of the month. Works in school pools too, which
 * is where bringing old schoolmates in matters most.
 */
export function RecruiterPrizeSetup() {
  const { pool, me, season } = useLeague();
  const nameOf = useNameOf();
  const [prizes, reload] = usePoolRecruiterPrizes(pool?.id);
  const [businesses, setBusinesses] = useState<Business[] | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [sponsorId, setSponsorId] = useState<number | null>(null);
  const [prize, setPrize] = useState("");
  const [details, setDetails] = useState("");
  const [photo, setPhoto] = useState<{ blob: Blob; preview: string } | null>(null);
  const [openPrize, setOpenPrize] = useState<RecruiterPrize | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc("my_businesses").then(({ data }) => setBusinesses((data ?? []) as Business[]));
  }, []);

  // Nothing to show someone without a business, unless the pool already has recruiter prizes.
  if (!pool || season.is_replay || businesses === null || (businesses.length === 0 && prizes.length === 0)) return null;
  const business = businesses.find((b) => b.id === sponsorId) ?? businesses[0] ?? null;
  const free = offerMonths().filter((m) => !prizes.some((p) => p.month === m));
  const pick = month && free.includes(month) ? month : free[0] ?? null;

  async function offer(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    if (!pick || !business) return;
    setBusy(true);
    let image_path: string | null = null;
    if (photo) {
      const path = `${business.id}/${crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from("prize-photos").upload(path, photo.blob, { contentType: "image/jpeg" });
      if (up.error) { setBusy(false); setMsg("Couldn't upload that photo. Try another one."); return; }
      image_path = path;
    }
    const { error } = await supabase.from("recruiter_prizes").insert({
      pool_id: pool!.id, month: pick, sponsor_id: business.id, sponsor: business.name,
      prize: prize.trim(), details: details.trim() || null, image_path,
    });
    setBusy(false);
    if (error) {
      if (image_path) await supabase.storage.from("prize-photos").remove([image_path]);
      setMsg(error.message.includes("reword") ? error.message
        : "That didn't go through. A recruiter prize can only go on this month or next, and not while a prize you offered is still waiting to be marked received.");
      return;
    }
    setPrize(""); setDetails(""); clearPhoto(); reload();
  }

  async function pickPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMsg(null);
    try {
      const blob = await shrinkPhoto(file);
      clearPhoto();
      setPhoto({ blob, preview: URL.createObjectURL(blob) });
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  function clearPhoto() {
    if (photo) URL.revokeObjectURL(photo.preview);
    setPhoto(null);
  }

  async function withdraw(m: string) {
    setMsg(null);
    await supabase.from("recruiter_prizes").delete().eq("pool_id", pool!.id).eq("month", m);
    reload();
  }

  return (
    <div className="card">
      <h2>Recruiter prize for {pool.name}</h2>
      <p className="sub">For whoever here brings the most new players onto Scrumline in a month, from your business. {RULE} The winner confirms it arrived.</p>
      {business && (free.length === 0 ? <p className="muted">This month and next already have a recruiter prize.</p> : (
        <form className="prizeform" onSubmit={offer}>
          <div className="prizefields">
            <select value={pick ?? ""} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
              {free.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
            </select>
            {businesses.length > 1 ? (
              <select value={business.id} onChange={(e) => setSponsorId(Number(e.target.value))} aria-label="Business">
                {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            ) : <span className="prize-biz">From {business.name}</span>}
            <input required maxLength={60} placeholder="Prize, e.g. a team jersey" value={prize} onChange={(e) => setPrize(e.target.value)} />
          </div>
          <textarea className="prize-details-in" maxLength={280} rows={3}
            placeholder="Details (optional), e.g. any size, we courier it anywhere in SA"
            value={details} onChange={(e) => setDetails(e.target.value)} />
          <div className="prize-photo-pick">
            {photo ? (
              <>
                <img className="prize-thumb" src={photo.preview} alt="Prize photo" />
                <button type="button" className="ghost prize-btn" onClick={clearPhoto}>Remove photo</button>
              </>
            ) : <label className="btn ghostlink prize-btn">Add a photo<input type="file" accept="image/*" hidden onChange={pickPhoto} /></label>}
          </div>
          <div><button type="submit" disabled={busy}>{busy ? "Offering…" : "Offer recruiter prize"}</button></div>
          <p className="small muted" style={{ margin: 0 }}>Once its month starts it can&apos;t be withdrawn.</p>
        </form>
      ))}
      {msg && <p className="small" style={{ marginTop: 10 }}>{msg}</p>}
      {prizes.length > 0 && (
        <ul className="prizelist">
          {[...prizes].reverse().map((p) => (
            <li key={p.month} className="tap" onClick={() => setOpenPrize(p)}>
              <span className="pl-round">{monthName(p.month).slice(0, 3)}</span>
              {p.image_path && <img className="prize-thumb small" src={prizePhotoUrl(p.image_path)} alt="" />}
              <span className="pl-what">
                {p.prize}
                <span className="prize-meta">{p.sponsor} · {standing(p, nameOf)}</span>
              </span>
              {p.status === "upcoming" && p.offered_by === me.user_id
                ? <span className="pl-acts"><button type="button" className="ghost prize-btn" onClick={(e) => { e.stopPropagation(); withdraw(p.month); }}>Withdraw</button></span>
                : <span className={p.status === "not delivered" ? "pl-st bad" : "pl-st"}>{STATUS[p.status]}</span>}
            </li>
          ))}
        </ul>
      )}
      {openPrize && (
        <PrizeDetail prize={shown_(openPrize)} nameOf={nameOf} onClose={() => setOpenPrize(null)}
          label={`${monthName(openPrize.month)} recruiter prize`} state={`${standing(openPrize, nameOf)}. ${RULE}`} />
      )}
    </div>
  );
}
