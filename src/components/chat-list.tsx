"use client";

import { useEffect, useMemo, useState } from "react";
import { LeaguePicture, SchoolPicture, leagueOf } from "@/components/league-picture";
import { PoolName } from "@/components/pool-name";
import { stickerLabel } from "@/components/stickers";
import { useLeague } from "@/components/league";
import { readCache, writeCache } from "@/lib/cache";
import { splitMentions } from "@/lib/mentions";
import { supabase } from "@/lib/supabase";
import type { ChatMessage, Pool } from "@/lib/types";

type Last = Pick<ChatMessage, "id" | "author_id" | "body" | "created_at" | "image_path" | "hidden_at" | "sticker"> & { pool_id: number };
interface Unread { pool_id: number; unread: number; tagged: number }
interface Pref { pool_id: number; pinned_at: string | null; muted: boolean; tags_only: boolean }
interface Snapshot { last: Last[]; unread: Unread[]; prefs?: Pref[] }

const PinIcon = () => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 4h6l-1 6 3 3v1H7v-1l3-3-1-6z" /><path d="M12 14v6" /></svg>;
const TagIcon = () => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2" /><path d="M15.2 12v1.3a2.4 2.4 0 0 0 4.8 0V12a8 8 0 1 0-3.2 6.4" /></svg>;
const BellIcon = () => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z" /><path d="M10 21h4" /></svg>;
const MuteIcon = () => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 16v-5a6 6 0 0 0-9.5-4.9M6.3 8.6A6 6 0 0 0 6 11v5l-2 2h13" /><path d="M10 21h4" /><path d="M3 3l18 18" /></svg>;

/** "14:05" today, "Yesterday", a weekday this week, else "4 Oct". */
function when(iso: string) {
  const d = new Date(iso), now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ago = Math.round((day(now) - day(d)) / 864e5);
  if (ago <= 0) return d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (ago === 1) return "Yesterday";
  if (ago < 7) return d.toLocaleDateString("en-ZA", { weekday: "long" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Every league's chat, newest first, like WhatsApp's chat list. */
export function ChatList({ pools, onOpen }: { pools: Pool[]; onOpen: (p: Pool) => void }) {
  const { me, members } = useLeague();
  const names = useMemo(() => new Map(members.map((m) => [m.user_id, m.display_name])), [members]);
  const ids = pools.map(leagueOf);
  const key = `chatlist:${ids.join(",")}`;
  // Drawn from what this device showed last time, then refreshed: no blank list, no jump.
  const [snap, setSnap] = useState<Snapshot>(() => readCache<Snapshot>(key) ?? { last: [], unread: [] });

  useEffect(() => {
    let live = true;
    const load = async () => {
      // One tiny indexed read per league (newest message), plus the unread counts in one go.
      const [u, pr, ...lasts] = await Promise.all([
        supabase.from("chat_unread").select("pool_id, unread, tagged").in("pool_id", ids),
        supabase.from("chat_prefs").select("pool_id, pinned_at, muted, tags_only").in("pool_id", ids),
        ...ids.map((id) => supabase.from("chat_messages")
          .select("id, pool_id, author_id, body, created_at, image_path, hidden_at, sticker")
          .eq("pool_id", id).order("id", { ascending: false }).limit(1).maybeSingle()),
      ]);
      if (!live || u.error) return;
      const fresh: Snapshot = { unread: (u.data ?? []) as Unread[], prefs: (pr.data ?? []) as Pref[], last: lasts.map((l) => l.data as Last | null).filter((l): l is Last => !!l) };
      writeCache(key, fresh);
      setSnap(fresh);
    };
    load();
    const ch = supabase.channel("chatlist")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, () => load())
      .subscribe();
    window.addEventListener("chat-read", load);
    return () => { live = false; supabase.removeChannel(ch); window.removeEventListener("chat-read", load); };
  }, [key]);

  const [menu, setMenu] = useState<Pool | null>(null);
  const [err, setErr] = useState("");
  const prefOf = (p: Pool) => snap.prefs?.find((x) => x.pool_id === leagueOf(p)) ?? null;
  const setPref = async (p: Pool, change: Partial<Pref>) => {
    const id = leagueOf(p), was = snap;
    const now: Pref = { pool_id: id, pinned_at: null, muted: false, tags_only: false, ...prefOf(p), ...change };
    const next = { ...snap, prefs: [...(snap.prefs ?? []).filter((x) => x.pool_id !== id), now] };
    setSnap(next); writeCache(key, next); setErr("");
    const { error } = await supabase.from("chat_prefs").upsert({ pool_id: id, pinned_at: now.pinned_at, muted: now.muted, tags_only: now.tags_only }, { onConflict: "user_id,pool_id" });
    if (error) { setSnap(was); writeCache(key, was); setErr("That didn't save. Check your connection and try again."); }
    else window.dispatchEvent(new Event("chat-read")); // the Chat tab's badge leaves muted leagues out
  };

  // Pinned chats stay on top in the order they were pinned (like WhatsApp); the rest newest first.
  const rows = pools.map((p) => ({
    p,
    last: snap.last.find((l) => l.pool_id === leagueOf(p)) ?? null,
    unread: snap.unread.find((u) => u.pool_id === leagueOf(p)) ?? null,
    pref: prefOf(p),
  })).sort((a, b) => {
    const pa = a.pref?.pinned_at ?? "", pb = b.pref?.pinned_at ?? "";
    if (pa || pb) return pa && pb ? pa.localeCompare(pb) : pa ? -1 : 1;
    return (b.last?.id ?? 0) - (a.last?.id ?? 0);
  });

  const preview = (l: Last) => {
    if (l.hidden_at) return "Message held while it's checked";
    const text = l.sticker ? (stickerLabel(l.sticker) === "Sticker" ? "Sticker" : `Sticker: ${stickerLabel(l.sticker)}`)
      : splitMentions(l.body ?? "").map((x) => ("userId" in x ? `@${names.get(x.userId!) ?? "someone"}` : x.text)).join("").trim()
        || (l.image_path ? "Photo" : "");
    const who = l.author_id === me.user_id ? "You" : names.get(l.author_id) ?? "Someone";
    return `${who}: ${l.image_path && !l.sticker && text !== "Photo" ? `📷 ${text}` : text}`;
  };

  const row = ({ p, last, unread, pref }: (typeof rows)[number]) => {
    // Tags only: the count is just the messages that tag you (shown as @), nothing else.
    const tagsOnly = !!pref?.tags_only && !pref?.muted;
    const n = tagsOnly ? (unread?.tagged ?? 0) : unread?.unread ?? 0, at = (unread?.tagged ?? 0) > 0, muted = !!pref?.muted;
    return (
      <li key={p.id}>
        <button type="button" className={`chatrow${n && !muted ? " new" : ""}${p.school_emis ? " school" : ""}`} onClick={() => onOpen(p)}
          onContextMenu={(e) => { e.preventDefault(); setMenu(p); }}>
          {/* Every row keeps the same picture spot: a school's crest on a square plaque, a mates' league's round picture or plain icon. */}
          {p.school_emis ? <SchoolPicture pool={p} size={46} /> : (
            <span className="chatrow-pic" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="9" cy="9" r="3.2" /><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" /><circle cx="16.5" cy="8" r="2.6" /><path d="M16.5 13c2.2 0 3.7 1.3 4.2 3.8" /></svg>
              <LeaguePicture pool={p} size={46} />
            </span>
          )}
          <span className="chatrow-main">
            <span className="chatrow-top">
              <span className="chatrow-name"><PoolName pool={p} /></span>
              {last && <span className="chatrow-time">{when(last.created_at)}</span>}
            </span>
            <span className="chatrow-bottom">
              <span className="chatrow-last">{last ? preview(last) : p.school_emis ? "Say hi to your old schoolmates" : "No messages yet"}</span>
              {muted && <span className="chatrow-flag" title="Muted" aria-label="Muted"><MuteIcon /></span>}
              {tagsOnly && <span className="chatrow-flag" title="Tags and replies only" aria-label="Tags and replies only"><TagIcon /></span>}
              {pref?.pinned_at && <span className="chatrow-flag" title="Pinned" aria-label="Pinned"><PinIcon /></span>}
              {n > 0 && <span className={`chatrow-count${at ? " at" : ""}${muted ? " quiet" : ""}`} aria-label={at ? "You were mentioned" : `${n} unread`}>{at ? "@" : n > 99 ? "99+" : n}</span>}
            </span>
          </span>
        </button>
        <button type="button" className="chatrow-more" aria-label={`Pin or mute ${p.name}`} onClick={() => setMenu(p)}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5.5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="18.5" r="1.7" /></svg>
        </button>
      </li>
    );
  };
  // Pinned on top; then schools under their own heading, so old schoolmates are always one tap away.
  const pinned = rows.filter((r) => r.pref?.pinned_at), rest = rows.filter((r) => !r.pref?.pinned_at);
  const schools = rest.filter((r) => r.p.school_emis), mates = rest.filter((r) => !r.p.school_emis);
  const sections = [pinned.length > 0 && rest.length > 0 && ["Pinned", pinned], schools.length > 0 && ["Your schools", schools], mates.length > 0 && ["Your leagues", mates]]
    .filter(Boolean) as [string, typeof rows][];
  const m = menu && prefOf(menu);

  return (
    <div className="card chatlist">
      <h2>Chats</h2>
      {err && <div className="notice" role="alert">{err}</div>}
      {sections.length > 1 ? sections.map(([title, rs]) => (
        <div key={title}>
          <div className="chatlist-sect">{title}</div>
          <ul>{rs.map(row)}</ul>
        </div>
      )) : <ul>{rows.map(row)}</ul>}
      {menu && (
        <div className="wip-dim" onClick={() => setMenu(null)}>
          <div className="wip-sheet" role="dialog" aria-label={`${menu.name} chat`} onClick={(e) => e.stopPropagation()}>
            <h2><PoolName pool={menu} /></h2>
            <div className="cp-opts">
              <button type="button" className="cp-opt" onClick={() => { setPref(menu, { pinned_at: m?.pinned_at ? null : new Date().toISOString() }); setMenu(null); }}>
                <PinIcon />
                <span><strong>{m?.pinned_at ? "Unpin" : "Pin to top"}</strong>
                  <small>{m?.pinned_at ? "It goes back to its usual place in your chats." : "Keeps this chat at the top of your list."}</small></span>
              </button>
            </div>
            <h3 className="cp-h">Alerts</h3>
            <div className="cp-opts">
              {([
                ["all", "Everything", "Every new message is counted. You're alerted when someone tags or replies to you.", { muted: false, tags_only: false }],
                ["tags", "Tags and replies only", "Ordinary messages aren't counted. Only tags and replies to you show up and alert you.", { muted: false, tags_only: true }],
                ["off", "Muted", "No phone alerts from this chat, even when you're tagged. It stays in your list.", { muted: true, tags_only: false }],
              ] as const).map(([k, title, hint, change]) => {
                const on = k === "off" ? !!m?.muted : k === "tags" ? !!m?.tags_only && !m?.muted : !m?.muted && !m?.tags_only;
                return (
                  <button type="button" key={k} className={`cp-opt${on ? " on" : ""}`} aria-pressed={on} onClick={() => { setPref(menu, change); setMenu(null); }}>
                    {k === "off" ? <MuteIcon /> : k === "tags" ? <TagIcon /> : <BellIcon />}
                    <span><strong>{title}</strong><small>{hint}</small></span>
                    {on && <svg className="cp-tick" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
                  </button>
                );
              })}
            </div>
            <button type="button" className="wip-save ghost" onClick={() => setMenu(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
