"use client";

import { useState, type ChangeEvent } from "react";
import { shieldFor, type Division } from "@/lib/crest";
import { supabase } from "@/lib/supabase";

const SHIELD = "M4 4h56v26c0 15-12 25-28 30C16 55 4 45 4 30z";

function Charge({ d, metal }: { d: Division; metal: string }) {
  switch (d) {
    case "chevron": return <path d="M4 44 32 18l28 26v10L32 28 4 54z" fill={metal} />;
    case "pale": return <rect x="32" y="0" width="32" height="64" fill={metal} />;
    case "bend": return <path d="M4 4h12l44 44v12z" fill={metal} />;
    case "quarterly": return <path d="M32 4h28v28H32zM4 32h28v32H4z" fill={metal} />;
    case "fess": return <rect x="0" y="22" width="64" height="14" fill={metal} />;
    case "saltire": return <path d="M4 4h8l20 20 20-20h8v6L38 30l22 22v8h-6L32 38 10 60H4v-6l22-22L4 10z" fill={metal} />;
  }
}

/** A school's crest: its real one when added, otherwise its own plain shield. */
export function Crest({ emis, path, size = 40, name }: { emis: string; path?: string | null; size?: number; name?: string }) {
  const [broken, setBroken] = useState(false);
  if (path && !broken) {
    const url = supabase.storage.from("school-crests").getPublicUrl(path).data.publicUrl;
    return <img className="crest" src={url} alt={name ? `${name} crest` : ""} width={size} height={size} onError={() => setBroken(true)} />;
  }
  const s = shieldFor(emis);
  const clip = `crest-${emis}`;
  return (
    <svg className="crest" viewBox="0 0 64 64" width={size} height={size} role={name ? "img" : undefined} aria-hidden={name ? undefined : true} aria-label={name ? `${name} shield` : undefined}>
      <defs><clipPath id={clip}><path d={SHIELD} /></clipPath></defs>
      <g clipPath={`url(#${clip})`}>
        <rect width="64" height="64" fill={s.field} />
        <Charge d={s.division} metal={s.metal} />
      </g>
      <path d={SHIELD} fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="1.5" />
    </svg>
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
