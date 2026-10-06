import { readCache, writeCache } from "./cache";
import { supabase } from "./supabase";

/**
 * Pictures in private buckets (avatars, league pictures) are shown through
 * signed links. A new picture gets a new file name, so one link per file can
 * be reused on every screen and across visits: it's kept on this device until
 * a day before it runs out. The same link means the phone shows the picture
 * from its own cache on the first frame, instead of a blank or initials
 * flashing before it on every page.
 */
const LINK_SECONDS = 7 * 24 * 3600;
const pending = new Map<string, Promise<string | null>>();
type Kept = { u: string; until: number };

/** The link already on this device, if it's still good. Synchronous, so a screen can draw it straight away. */
export function keptLink(bucket: string, path: string): string | null {
  const k = readCache<Kept | null>(`link:${bucket}/${path}`);
  return k && k.until > Date.now() ? k.u : null;
}

export function forgetLink(bucket: string, path: string): void {
  writeCache(`link:${bucket}/${path}`, null);
  pending.delete(`${bucket}/${path}`);
}

export function signedLink(bucket: string, path: string): Promise<string | null> {
  const kept = keptLink(bucket, path);
  if (kept) return Promise.resolve(kept);
  const id = `${bucket}/${path}`;
  let p = pending.get(id);
  if (!p) {
    p = supabase.storage.from(bucket).createSignedUrl(path, LINK_SECONDS)
      .then(({ data }) => {
        const u = data?.signedUrl ?? null;
        if (u) writeCache(`link:${id}`, { u, until: Date.now() + (LINK_SECONDS - 24 * 3600) * 1000 });
        else pending.delete(id);
        return u;
      }, () => { pending.delete(id); return null; });
    pending.set(id, p);
  }
  return p;
}
