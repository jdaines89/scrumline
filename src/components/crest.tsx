"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { readCache, writeCache } from "@/lib/cache";
import { supabase } from "@/lib/supabase";

/**
 * A school's crest when it has added its real one. Until then a plain school
 * icon, the same for every school: we never invent a crest for a school.
 */
export function Crest({ emis, path, size = 40, name }: { emis: string; path?: string | null; size?: number; name?: string }) {
  const [broken, setBroken] = useState(false);
  if (path && !broken) {
    const url = supabase.storage.from("school-crests").getPublicUrl(path).data.publicUrl;
    return <img className="school-mark" src={url} alt={name ? `${name} crest` : ""} width={size} height={size} onError={() => setBroken(true)} />;
  }
  return (
    <span className="school-mark plain" data-emis={emis} aria-hidden style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" width={Math.round(size * 0.56)} height={Math.round(size * 0.56)} fill="none" stroke="currentColor"
        strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 10 12 5l9 5" />
        <path d="M5 10v9h14v-9" />
        <path d="M10 19v-4h4v4" />
        <path d="M8 13h.01M16 13h.01" />
      </svg>
    </span>
  );
}

/** Lets an admin or the school's verified contact put up the school's real crest. */
export function CrestUpload({ emis, hasCrest, onDone, note }: { emis: string; hasCrest: boolean; onDone: () => void; note: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const blob = await squarePng(file);
      const path = `${emis}/${crypto.randomUUID()}.png`;
      const up = await supabase.storage.from("school-crests").upload(path, blob, { contentType: "image/png" });
      if (up.error) throw new Error(up.error.message);
      const { error } = await supabase.rpc("set_school_crest", { p_emis: emis, p_path: path });
      if (error) throw new Error(error.message);
      onDone();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "That didn't work. Try another picture.");
    }
    setBusy(false);
  }
  return (
    <div className="sch-crest-up">
      <label className="btn ghost">
        {busy ? "Adding the crest…" : hasCrest ? "Change the crest" : "Add the school's crest"}
        <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={busy} onChange={pick} />
      </label>
      <span className="small muted">{note}</span>
      {msg && <p className="small" style={{ margin: 0, color: "var(--danger)" }}>{msg}</p>}
    </div>
  );
}

/** The crest fitted into a 512px transparent square, so every crest sits the same way. */
async function squarePng(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => fail(new Error("That file isn't a picture this phone can open."));
      i.src = url;
    });
    const side = 512;
    const scale = Math.min(side / img.naturalWidth, side / img.naturalHeight);
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = side; canvas.height = side;
    canvas.getContext("2d")!.drawImage(img, (side - w) / 2, (side - h) / 2, w, h);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
    if (!blob) throw new Error("That picture couldn't be read.");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Real crests schools have added, by EMIS number. Small: one row per school that has one. */
export function useCrests(): Map<string, string> {
  const [rows, setRows] = useState<Record<string, string>>(() => readCache<Record<string, string>>("crests1") ?? {});
  useEffect(() => {
    supabase.from("school_crests").select("emis, image_path").then(({ data }) => {
      const out: Record<string, string> = {};
      for (const r of (data ?? []) as { emis: string; image_path: string }[]) out[r.emis] = r.image_path;
      writeCache("crests1", out); setRows(out);
    });
  }, []);
  return new Map(Object.entries(rows));
}

/** A school's real crest in a list, or nothing: rows don't repeat the same plain icon. */
export function ListCrest({ emis, crests, size }: { emis: string; crests: Map<string, string>; size: number }) {
  const path = crests.get(emis);
  return path ? <Crest emis={emis} path={path} size={size} /> : null;
}
