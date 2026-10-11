"use client";

import { useEffect, useState } from "react";
import { useLeague } from "@/components/league";
import { CrestUpload, useCrests } from "@/components/crest";
import { TapToEnlarge } from "@/components/image-view";
import { PicturePicker } from "@/components/picture-picker";
import { readCache, writeCache } from "@/lib/cache";
import { forgetLink, keptLink, signedLink } from "@/lib/signed-link";
import { supabase } from "@/lib/supabase";
import type { Pool } from "@/lib/types";

// League pictures sit in a private bucket that only the league's players can
// read, so each is shown through a signed link. A new picture gets a new file
// name, so one link per path can be kept for as long as it lasts.
const BUCKET = "league-pictures";
// A league's picture sits on its first table; its other tournaments look it up there.
const leaguePaths = new Map<number, Promise<string | null>>();

function leaguePath(league: number): Promise<string | null> {
  let p = leaguePaths.get(league);
  if (!p) {
    p = Promise.resolve(supabase.from("pools").select("picture_path").eq("id", league).maybeSingle())
      .then(({ data }) => {
        const path = (data as { picture_path: string | null } | null)?.picture_path ?? null;
        writeCache(`lpath:${league}`, path);
        return path;
      }, () => readCache<string | null>(`lpath:${league}`) ?? null);
    leaguePaths.set(league, p);
  }
  return p;
}

/** The league's first table, which holds its chat and picture. */
export const leagueOf = (pool: Pool) => pool.league_id ?? pool.id;

/**
 * A school league's picture: the school's crest on a plaque, square-cornered so
 * school chats stand apart from mates' round pictures. A class league adds its
 * year under the crest. A school with no real crest gets a plain school icon:
 * we never invent one.
 */
export function SchoolPicture({ pool, size = 40, expandable = false }: { pool: Pool; size?: number; expandable?: boolean }) {
  const crests = useCrests();
  const path = crests.get(pool.school_emis!) ?? null;
  const url = path ? supabase.storage.from("school-crests").getPublicUrl(path).data.publicUrl : null;
  // The year only where it can be read; small spots carry it in the name already.
  const year = pool.school_year && size >= 40 ? pool.school_year : null;
  const mark = Math.round(size * (year ? 0.6 : 0.78));
  const pic = (
    <span className={`school-pic${year ? " with-year" : ""}`} style={{ width: size, height: size }} aria-hidden="true">
      {url ? <img src={url} alt="" width={mark} height={mark} decoding="async" />
        : <svg viewBox="0 0 24 24" width={Math.round(mark * 0.72)} height={Math.round(mark * 0.72)} fill="none" stroke="currentColor"
          strokeWidth="1.6" strokeLinejoin="round"><path d="M3 10 12 5l9 5M5 10v9h14v-9M10 19v-5h4v5" /></svg>}
      {year && <span className="school-pic-year" style={{ fontSize: Math.max(9, Math.round(size * 0.21)) }}>{year}</span>}
    </span>
  );
  return expandable && url ? <TapToEnlarge src={url} alt="School crest" maxPx={240}>{pic}</TapToEnlarge> : pic;
}

/** For an admin or the school's own contact: change the crest every league of the school shows. */
export function SchoolPictureEdit({ pool }: { pool: Pool }) {
  const emis = pool.school_emis;
  const crests = useCrests();
  const [can, setCan] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!emis) return;
    let live = true;
    supabase.rpc("can_set_crest", { p_emis: emis }).then(({ data }) => { if (live) setCan(data === true); });
    return () => { live = false; };
  }, [emis]);
  if (!emis || !can) return null;
  const has = crests.has(emis);
  return (
    <div className="league-pic-edit">
      <p className="small muted">
        <button type="button" className="linkish small" onClick={() => setOpen(!open)}>
          {open ? "Close" : has ? "Change the school crest" : "Add the school crest"}
        </button>
      </p>
      {open && <CrestUpload emis={emis} hasCrest={has} onDone={() => setOpen(false)}
        note="It shows on every league and class of the school. Only admins and the school's own contact can change it." />}
    </div>
  );
}

/**
 * A mates' league's picture, like a WhatsApp group's. Nothing at all when the
 * league has none; when it has one, its space is kept while it loads so the
 * page doesn't jump.
 */
export function LeaguePicture({ pool, size = 40, expandable = false }: { pool: Pool; size?: number; expandable?: boolean }) {
  return pool.school_emis ? <SchoolPicture pool={pool} size={size} expandable={expandable} /> : <MatesPicture pool={pool} size={size} expandable={expandable} />;
}

function MatesPicture({ pool, size, expandable }: { pool: Pool; size: number; expandable: boolean }) {
  const league = leagueOf(pool);
  const borrowed = !pool.school_emis && league !== pool.id;
  // Start from what this phone last saw, so the picture is there on the first frame.
  const [found, setFound] = useState<string | null>(() => borrowed ? readCache<string | null>(`lpath:${league}`) ?? null : null);
  const [changed, setChanged] = useState(0);
  useEffect(() => {
    const again = () => setChanged((n) => n + 1);
    window.addEventListener("league-picture", again);
    return () => window.removeEventListener("league-picture", again);
  }, []);
  useEffect(() => {
    let live = true;
    if (borrowed) leaguePath(league).then((p) => { if (live) setFound(p); });
    return () => { live = false; };
  }, [borrowed, league, changed]);
  const path = pool.school_emis ? null : league === pool.id ? pool.picture_path ?? null : found;
  const [src, setSrc] = useState<string | null>(() => path ? keptLink(BUCKET, path) : null);
  // Only a picture arriving for the first time fades in; one already on the phone just shows.
  const [instant] = useState(() => !!src);
  useEffect(() => {
    let live = true;
    if (!path) { setSrc(null); return; }
    const kept = keptLink(BUCKET, path);
    if (kept) { setSrc(kept); return; }
    signedLink(BUCKET, path).then((u) => { if (live) setSrc(u); });
    return () => { live = false; };
  }, [path]);
  if (!path) return null;
  const style = { width: size, height: size };
  const pic = (
    <span className="league-pic" style={style} aria-hidden="true">
      {src && <img src={src} alt="" className={instant ? undefined : "fade-in"} decoding="async" onError={() => { forgetLink(BUCKET, path); setSrc(null); }} />}
    </span>
  );
  return expandable ? <TapToEnlarge src={src} alt="League picture">{pic}</TapToEnlarge> : pic;
}

/** For whoever started a mates' league: add, change or remove its picture. */
export function LeaguePicturePicker({ onMessage }: { onMessage: (ok: boolean, text: string) => void }) {
  const { pool, me, reloadPools } = useLeague();
  const league = pool ? leagueOf(pool) : 0;
  const [old, setOld] = useState<string | null>(pool?.picture_path ?? null);
  useEffect(() => {
    if (!pool) return;
    if (league === pool.id) { setOld(pool.picture_path ?? null); return; }
    leaguePath(league).then(setOld);
  }, [league, pool]);
  if (!pool || pool.school_emis || pool.created_by !== me.user_id) return null;

  /** After a change: every tournament's copy of the league looks again. */
  function changed() { leaguePaths.delete(league); window.dispatchEvent(new Event("league-picture")); leaguePath(league).then(setOld); }

  // The picture belongs to the league, so it's kept on its first table.
  async function save(blob: Blob) {
    const path = `${league}/${crypto.randomUUID()}.jpg`;
    const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" });
    if (up.error) throw up.error;
    const { error } = await supabase.rpc("set_league_picture", { p_pool: league, p_path: path });
    if (error) { await supabase.storage.from(BUCKET).remove([path]); throw error; }
    if (old) await supabase.storage.from(BUCKET).remove([old]);
    changed();
    await reloadPools();
    onMessage(true, "League picture saved.");
  }

  async function remove() {
    const { error } = await supabase.rpc("set_league_picture", { p_pool: league, p_path: null });
    if (error) throw error;
    if (old) await supabase.storage.from(BUCKET).remove([old]);
    changed();
    await reloadPools();
  }

  return (
    <PicturePicker label="League picture, like a WhatsApp group's. Only players in this league see it."
      preview={old ? <LeaguePicture pool={pool} size={56} /> : <span className="league-pic empty" style={{ width: 56, height: 56 }} aria-hidden="true" />}
      has={!!old} onSave={save} onRemove={remove} onMessage={onMessage} />
  );
}

/** A link to the league's picture, or null when it has none (school leagues show crests, not pictures). */
export async function leaguePictureLink(pool: Pool): Promise<string | null> {
  if (pool.school_emis) return null;
  const league = leagueOf(pool);
  const path = league === pool.id ? pool.picture_path ?? null : await leaguePath(league);
  return path ? signedLink(BUCKET, path) : null;
}
