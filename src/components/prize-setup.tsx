"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { useLeague } from "@/components/league";
import { PrizeDetail } from "@/components/prize-detail";
import { shrinkPhoto } from "@/lib/photo";
import { day } from "@/components/prize-line";
import { PrizeChat } from "@/components/prize-chat";
import { prizePhotoUrl, trackRecord, usePoolPrizes, whoWon, type PoolPrize } from "@/lib/prizes";
import { supabase } from "@/lib/supabase";

const STATUS: Record<PoolPrize["status"], string> = {
  upcoming: "Upcoming", "in play": "In play", "no winner": "No winner", awaiting: "Awaiting",
  delivered: "Delivered", "not delivered": "Not delivered",
};

interface Business { id: number; name: string }

/**
 * For any member of a mates' pool who runs a business on Scrumline: put up a
 * prize for a round, in the business's name. It's your promise: it locks at
 * the round's first kickoff, the winner marks it received, and the pool sees
 * the track record.
 */
export function PrizeSetup() {
  const { pool, me, members, matches, season } = useLeague();
  const [prizes, reload] = usePoolPrizes(pool?.id);
  const open = useMemo(() => {
    const first = new Map<number, string>();
    for (const m of matches) if (!first.has(m.round) || m.kickoff_at < first.get(m.round)!) first.set(m.round, m.kickoff_at);
    const now = new Date().toISOString();
    return [...first].filter(([, k]) => k > now).map(([r]) => r).sort((a, b) => a - b);
  }, [matches]);
  const [round, setRound] = useState<number | null>(null);
  const [businesses, setBusinesses] = useState<Business[] | null>(null);
  const [sponsorId, setSponsorId] = useState<number | null>(null);
  const [prize, setPrize] = useState("");
  const [details, setDetails] = useState("");
  const [openPrize, setOpenPrize] = useState<PoolPrize | null>(null);
  // The prize being changed, and whether its current photo stays.
  const [editing, setEditing] = useState<PoolPrize | null>(null);
  const [keepPhoto, setKeepPhoto] = useState(true);
  const [every, setEvery] = useState(false);
  const [photo, setPhoto] = useState<{ blob: Blob; preview: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Prizes this player's business owes: won, not yet confirmed received.
  const [chat, setChat] = useState<PoolPrize | null>(null);
  const handover = prizes.filter((p) => p.offered_by === me.user_id && p.status === "awaiting" && p.winners?.length);
  const nameOf = (id: string) => (id === me.user_id ? "You" : members.find((m) => m.user_id === id)?.display_name ?? "A mate");

  useEffect(() => {
    supabase.rpc("my_businesses").then(({ data }) => setBusinesses((data ?? []) as Business[]));
  }, []);

  if (!pool || pool.school_emis || season.is_replay) return null;
  const business = businesses?.find((b) => b.id === sponsorId) ?? businesses?.[0] ?? null;
  const pick = round ?? open.find((r) => !prizes.some((p) => p.round === r)) ?? open[0] ?? null;
  const rec = trackRecord(prizes);

  async function offer(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    if (editing) { await saveEdit(); return; }
    if (pick === null || !business) return;
    const rounds = (every ? open.filter((r) => r >= pick) : [pick]).filter((r) => !prizes.some((p) => p.round === r));
    if (!rounds.length) { setMsg("There's already a prize on that round."); return; }
    setBusy(true);
    let image_path: string | null = null;
    if (photo) {
      const path = `${business.id}/${crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from("prize-photos").upload(path, photo.blob, { contentType: "image/jpeg" });
      if (up.error) { setBusy(false); setMsg("Couldn't upload that photo. Try another one."); return; }
      image_path = path;
    }
    const { error } = await supabase.from("round_prizes")
      .insert(rounds.map((r) => ({ pool_id: pool!.id, round: r, sponsor_id: business.id, prize: prize.trim(), details: details.trim() || null, image_path })));
    setBusy(false);
    if (error) {
      if (image_path) await supabase.storage.from("prize-photos").remove([image_path]);
      setMsg(error.message.includes("reword") ? error.message
        : "That didn't go through. Prizes can only go on rounds that haven't kicked off, in pools of up to 50, and not while a prize you offered is still waiting to be marked received.");
      return;
    }
    setPrize(""); setDetails(""); setEvery(false); clearPhoto(); reload();
  }

  const canEdit = (p: PoolPrize) => p.offered_by === me.user_id && p.edit_until !== null && new Date(p.edit_until) > new Date();

  function startEdit(p: PoolPrize) {
    setMsg(null); clearPhoto();
    setEditing(p); setKeepPhoto(true);
    setPrize(p.prize); setDetails(p.details ?? "");
    document.getElementById("prize-what")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function stopEdit() {
    setEditing(null); setPrize(""); setDetails(""); clearPhoto();
  }

  async function saveEdit() {
    const p = editing!;
    const folder = p.image_path?.split("/")[0] ?? String(business?.id ?? "");
    setBusy(true);
    let image_path: string | null = keepPhoto ? p.image_path : null;
    if (photo) {
      const path = `${folder}/${crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from("prize-photos").upload(path, photo.blob, { contentType: "image/jpeg" });
      if (up.error) { setBusy(false); setMsg("Couldn't upload that photo. Try another one."); return; }
      image_path = path;
    }
    const { error } = await supabase.rpc("edit_round_prize", {
      p_pool: pool!.id, p_round: p.round, p_prize: prize.trim(), p_details: details.trim() || null, p_image_path: image_path,
    });
    setBusy(false);
    if (error) {
      if (photo && image_path) await supabase.storage.from("prize-photos").remove([image_path]);
      setMsg(error.message.includes("reword") || error.message.includes("48 hours") ? error.message : "That didn't save. Try again.");
      return;
    }
    if (p.image_path && p.image_path !== image_path) await supabase.storage.from("prize-photos").remove([p.image_path]);
    stopEdit(); reload();
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

  async function withdraw(r: number) {
    setMsg(null);
    if (editing?.round === r) stopEdit();
    await supabase.from("round_prizes").delete().eq("pool_id", pool!.id).eq("round", r);
    reload();
  }

  return (
    <div className="card">
      <h2>Round prize for {pool.name}</h2>
      <p className="sub">For the round&apos;s top caller, from your business. You can change it up to 48 hours before kickoff and withdraw it until kickoff. The winner confirms it arrived. You can&apos;t win your own prize: it goes to the best of everyone else.</p>
      {businesses === null ? null : businesses.length === 0 ? (
        <p className="small muted">Prizes come from a business, so everyone knows who&apos;s behind them. <Link href="/sponsor/profile/">Set up your business profile</Link> and come back here.</p>
      ) : open.length === 0 ? <p className="muted">Every round has kicked off, so there&apos;s nothing left to put a prize on.</p> : (
        <form className="prizeform" onSubmit={offer}>
          <div className="prizefields">
            {editing ? <span className="prize-biz">Round {editing.round}</span> : (
              <select id="prize-round" value={pick ?? ""} onChange={(e) => setRound(Number(e.target.value))} aria-label="Round">
                {open.map((r) => <option key={r} value={r}>Round {r}</option>)}
              </select>
            )}
            {editing ? <span className="prize-biz">From {editing.sponsor}</span> : businesses.length > 1 ? (
              <select id="prize-sponsor" value={business?.id ?? ""} onChange={(e) => setSponsorId(Number(e.target.value))} aria-label="Business">
                {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            ) : <span id="prize-sponsor" className="prize-biz">From {business?.name}</span>}
            <input id="prize-what" required maxLength={60} placeholder="Prize, e.g. R200 bar tab" value={prize} onChange={(e) => setPrize(e.target.value)} />
          </div>
          <textarea id="prize-details" className="prize-details-in" maxLength={280} rows={3}
            placeholder="Details (optional), e.g. any size, collect at our Stellenbosch shop"
            value={details} onChange={(e) => setDetails(e.target.value)} />
          <div className="prize-photo-pick">
            {photo ? (
              <>
                <img className="prize-thumb" src={photo.preview} alt="Prize photo" />
                <button type="button" className="ghost prize-btn" onClick={clearPhoto}>Remove photo</button>
              </>
            ) : editing?.image_path && keepPhoto ? (
              <>
                <img className="prize-thumb" src={prizePhotoUrl(editing.image_path)} alt="Prize photo" />
                <label className="btn ghostlink prize-btn">Change photo<input type="file" accept="image/*" hidden onChange={pickPhoto} /></label>
                <button type="button" className="ghost prize-btn" onClick={() => setKeepPhoto(false)}>Remove</button>
              </>
            ) : (
              <label className="btn ghostlink prize-btn">Add a photo<input type="file" accept="image/*" hidden onChange={pickPhoto} /></label>
            )}
          </div>
          {editing ? (
            <div className="prize-actions">
              <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
              <button type="button" className="ghost" onClick={stopEdit}>Cancel</button>
            </div>
          ) : (
            <>
              <label className="small"><input id="prize-every" type="checkbox" checked={every} onChange={(e) => setEvery(e.target.checked)} /> Every round after that too</label>
              <div><button type="submit" disabled={busy}>{busy ? "Offering…" : "Offer prize"}</button></div>
            </>
          )}
        </form>
      )}
      {msg && <p className="small" style={{ marginTop: 10 }}>{msg}</p>}
      {handover.map((p) => {
        const who = whoWon(p, nameOf);
        return (
          <div key={p.round} className="handover">
            <span className="prize-label">To hand over · round {p.round}</span>
            <strong>{who} won your {p.prize}</strong>
            <span className="prize-meta">
              Get it to {p.winners!.length > 1 ? "them" : who}{p.due_at ? ` by ${day(p.due_at)}` : ""}. They tap Received once they have it,
              which keeps your track record clean. Not confirmed by then counts as not delivered.
            </span>
            <span className="prize-acts">
              <button type="button" className="prize-btn" onClick={() => setChat(p)}>Message {p.winners!.length > 1 ? "the winners" : who}</button>
            </span>
          </div>
        );
      })}
      {chat && <PrizeChat prize={chat} onClose={() => setChat(null)} />}
      {prizes.length > 0 && (
        <>
          <ul className="prizelist">
            {prizes.map((p) => (
              <li key={p.round} className="tap" onClick={() => setOpenPrize(p)}>
                <span className="pl-round">R{p.round}</span>
                {p.image_path && <img className="prize-thumb small" src={prizePhotoUrl(p.image_path)} alt="" />}
                <span className="pl-what">
                  {p.prize}
                  <span className="prize-meta">{p.sponsor}{p.winners?.length ? ` · ${whoWon(p, nameOf)}` : ""}</span>
                </span>
                {p.status === "upcoming" && p.offered_by === me.user_id ? (
                  <span className="pl-acts">
                    {canEdit(p) && <button type="button" className="ghost prize-btn" onClick={(e) => { e.stopPropagation(); startEdit(p); }}>Edit</button>}
                    <button type="button" className="ghost prize-btn" onClick={(e) => { e.stopPropagation(); withdraw(p.round); }}>Withdraw</button>
                  </span>
                ) : <span className={p.status === "not delivered" ? "pl-st bad" : "pl-st"}>{STATUS[p.status]}</span>}
              </li>
            ))}
          </ul>
          {rec.decided > 0 && <p className="prize-meta" style={{ marginTop: 10 }}>Delivered {rec.delivered} of {rec.decided}</p>}
          {openPrize && <PrizeDetail prize={openPrize} nameOf={(id) => nameOf(id).toLowerCase() === "you" ? "you" : nameOf(id)} onClose={() => setOpenPrize(null)} />}
        </>
      )}
    </div>
  );
}
