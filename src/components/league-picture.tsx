"use client";

import { useEffect, useState } from "react";
import { useLeague } from "@/components/league";
import { PicturePicker } from "@/components/picture-picker";
import { supabase } from "@/lib/supabase";
import type { Pool } from "@/lib/types";

// League pictures sit in a private bucket that only the league's players can
// read, so each is shown through a signed link. A new picture gets a new file
// name, so one link per path can be kept for as long as it lasts.
const BUCKET = "league-pictures";
const LINK_SECONDS = 7 * 24 * 3600;
const links = new Map<string, Promise<string | null>>();
// A league's picture sits on its first table; its other tournaments look it up there.
const leaguePaths = new Map<number, Promise<string | null>>();

function leaguePath(league: number): Promise<string | null> {
  let p = leaguePaths.get(league);
  if (!p) {
    p = Promise.resolve(supabase.from("pools").select("picture_path").eq("id", league).maybeSingle())
      .then(({ data }) => (data as { picture_path: string | null } | null)?.picture_path ?? null, () => null);
    leaguePaths.set(league, p);
  }
  return p;
}

/** The league's first table, which holds its chat and picture. */
export const leagueOf = (pool: Pool) => pool.league_id ?? pool.id;

function linkFor(path: string): Promise<string | null> {
  let p = links.get(path);
  if (!p) {
    p = supabase.storage.from(BUCKET).createSignedUrl(path, LINK_SECONDS)
      .then(({ data }) => data?.signedUrl ?? null, () => null);
    links.set(path, p);
  }
  return p;
}

/**
 * A mates' league's picture, like a WhatsApp group's. Nothing at all when the
 * league has none; when it has one, its space is kept while it loads so the
 * page doesn't jump.
 */
export function LeaguePicture({ pool, size = 40 }: { pool: Pool; size?: number }) {
  const league = leagueOf(pool);
  const [found, setFound] = useState<string | null>(null);
  const [changed, setChanged] = useState(0);
  useEffect(() => {
    const again = () => setChanged((n) => n + 1);
    window.addEventListener("league-picture", again);
    return () => window.removeEventListener("league-picture", again);
  }, []);
  useEffect(() => {
    let live = true;
    setFound(null);
    if (!pool.school_emis && league !== pool.id) leaguePath(league).then((p) => { if (live) setFound(p); });
    return () => { live = false; };
  }, [league, pool.id, pool.school_emis, changed]);
  const path = pool.school_emis ? null : league === pool.id ? pool.picture_path ?? null : found;
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setSrc(null);
    if (path) linkFor(path).then((u) => { if (live) setSrc(u); });
    return () => { live = false; };
  }, [path]);
  if (!path) return null;
  const style = { width: size, height: size };
  return (
    <span className="league-pic" style={style} aria-hidden="true">
      {src && <img src={src} alt="" className="fade-in" onError={() => setSrc(null)} />}
    </span>
  );
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
