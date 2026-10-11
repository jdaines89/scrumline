/**
 * Saves score calls one match at a time, newest value last.
 *
 * Saving on every keystroke used to fire a request for "3" and another for "32"
 * at almost the same moment; the database could finish them in either order,
 * so a call could end up stored as "3" while the screen showed "32". Here each
 * match waits a moment after the last keystroke, has at most one save in
 * flight, and when that save returns sends whatever was typed since. The last
 * thing typed is always the last thing written.
 */
export type SaveState = "saving" | "saved" | "failed";

interface Slot<V> { want: V | null; busy: boolean; timer: ReturnType<typeof setTimeout> | null }

export function callSaver<V>(opts: {
  send: (key: string, value: V) => Promise<string | null>;
  onState: (key: string, state: SaveState, error?: string) => void;
  onSaved?: (key: string, value: V) => void;
  delay?: number;
}) {
  const slots = new Map<string, Slot<V>>();
  const slot = (k: string) => {
    let s = slots.get(k);
    if (!s) slots.set(k, s = { want: null, busy: false, timer: null });
    return s;
  };

  async function flush(k: string) {
    const s = slot(k);
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }
    if (s.busy || s.want === null) return;
    const v = s.want;
    s.want = null;
    s.busy = true;
    let error: string | null;
    try { error = await opts.send(k, v); } catch (e) { error = e instanceof Error ? e.message : "Couldn't save"; }
    s.busy = false;
    if (s.want !== null) { flush(k); return; }
    if (error) { s.want = v; opts.onState(k, "failed", error); return; }
    opts.onSaved?.(k, v);
    opts.onState(k, "saved");
  }

  return {
    /** A new value for a match: saved shortly, after any save already under way. */
    set(k: string, v: V) {
      const s = slot(k);
      s.want = v;
      opts.onState(k, "saving");
      if (s.timer) clearTimeout(s.timer);
      s.timer = setTimeout(() => flush(k), opts.delay ?? 400);
    },
    /** Typed but not yet valid (e.g. a lone "2"): nothing to send, drop anything queued. */
    drop(k: string) {
      const s = slot(k);
      if (s.timer) { clearTimeout(s.timer); s.timer = null; }
      s.want = null;
    },
    flush,
    flushAll() { for (const k of slots.keys()) flush(k); },
    pending() { return [...slots.values()].some((s) => s.busy || s.want !== null); },
  };
}
