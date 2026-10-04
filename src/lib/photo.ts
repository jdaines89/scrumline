import { supabase } from "@/lib/supabase";
import { readCache, writeCache } from "@/lib/cache";

const LONGEST = 1280;
const LIMIT = 1024 * 1024;

/** The size a photo is shrunk to: longest side at most 1280px, never enlarged. */
export function fitWithin(w: number, h: number, longest = LONGEST): { w: number; h: number } {
  const s = Math.min(1, longest / Math.max(w, h));
  return { w: Math.round(w * s), h: Math.round(h * s) };
}

/** Shrinks a photo on the phone to a JPEG under 1MB, so uploads stay quick and small. */
export async function shrinkPhoto(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => fail(new Error("That file isn't a photo this phone can open."));
      i.src = url;
    });
    const { w, h } = fitWithin(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
    for (const q of [0.82, 0.7, 0.55]) {
      const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", q));
      if (blob && blob.size <= LIMIT) return blob;
    }
    throw new Error("That photo is too big to send.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Signed links last an hour; reuse one until ten minutes before it runs out.
const links = new Map<string, { url: string; until: number }>();

export async function photoUrl(path: string): Promise<string | null> {
  const hit = links.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  const { data } = await supabase.storage.from("chat-photos").createSignedUrl(path, 3600);
  if (!data?.signedUrl) return null;
  links.set(path, { url: data.signedUrl, until: Date.now() + 50 * 60_000 });
  return data.signedUrl;
}

/** A chat photo's file name carries its size (`<uuid>_1280x960`), so the chat can keep its space before it loads. */
export async function sizedName(blob: Blob): Promise<string> {
  const id = crypto.randomUUID();
  try {
    const bmp = await createImageBitmap(blob);
    const name = `${id}_${bmp.width}x${bmp.height}`;
    bmp.close();
    return name;
  } catch {
    return id;
  }
}

/** The width and height in a photo's name, or for older photos the size seen last time on this phone. */
export function photoSize(path: string): { w: number; h: number } | undefined {
  const m = /_(\d{1,5})x(\d{1,5})\.jpg$/.exec(path);
  if (m) return { w: +m[1], h: +m[2] };
  return readCache<{ w: number; h: number }>(`psize:${path}`);
}

export function rememberPhotoSize(path: string, w: number, h: number): void {
  if (!/_\d+x\d+\.jpg$/.test(path) && w && h) writeCache(`psize:${path}`, { w, h });
}
