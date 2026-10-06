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
  const path = pool.school_emis ? null : pool.picture_path ?? null;
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
  if (!pool || pool.school_emis || pool.created_by !== me.user_id) return null;
  const old = pool.picture_path ?? null;

  async function save(blob: Blob) {
    const path = `${pool!.id}/${crypto.randomUUID()}.jpg`;
    const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" });
    if (up.error) throw up.error;
    const { error } = await supabase.rpc("set_league_picture", { p_pool: pool!.id, p_path: path });
    if (error) { await supabase.storage.from(BUCKET).remove([path]); throw error; }
    if (old) await supabase.storage.from(BUCKET).remove([old]);
    await reloadPools();
    onMessage(true, "League picture saved.");
  }

  async function remove() {
    const { error } = await supabase.rpc("set_league_picture", { p_pool: pool!.id, p_path: null });
    if (error) throw error;
    if (old) await supabase.storage.from(BUCKET).remove([old]);
    await reloadPools();
  }

  return (
    <PicturePicker label="League picture, like a WhatsApp group's. Only players in this league see it."
      preview={old ? <LeaguePicture pool={pool} size={56} /> : <span className="league-pic empty" style={{ width: 56, height: 56 }} aria-hidden="true" />}
      has={!!old} onSave={save} onRemove={remove} onMessage={onMessage} />
  );
}
