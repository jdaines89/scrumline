"use client";

import { useEffect, useMemo, useState } from "react";
import { LeaguePicture, leagueOf } from "@/components/league-picture";
import { PoolName } from "@/components/pool-name";
import { stickerLabel } from "@/components/stickers";
import { useLeague } from "@/components/league";
import { readCache, writeCache } from "@/lib/cache";
import { splitMentions } from "@/lib/mentions";
import { supabase } from "@/lib/supabase";
import type { ChatMessage, Pool } from "@/lib/types";

type Last = Pick<ChatMessage, "id" | "author_id" | "body" | "created_at" | "image_path" | "hidden_at" | "sticker"> & { pool_id: number };
interface Unread { pool_id: number; unread: number; tagged: number }
interface Snapshot { last: Last[]; unread: Unread[] }

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
      const [u, ...lasts] = await Promise.all([
        supabase.from("chat_unread").select("pool_id, unread, tagged").in("pool_id", ids),
        ...ids.map((id) => supabase.from("chat_messages")
          .select("id, pool_id, author_id, body, created_at, image_path, hidden_at, sticker")
          .eq("pool_id", id).order("id", { ascending: false }).limit(1).maybeSingle()),
      ]);
      if (!live || u.error) return;
      const fresh: Snapshot = { unread: (u.data ?? []) as Unread[], last: lasts.map((l) => l.data as Last | null).filter((l): l is Last => !!l) };
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

  const rows = pools.map((p) => ({
    p,
    last: snap.last.find((l) => l.pool_id === leagueOf(p)) ?? null,
    unread: snap.unread.find((u) => u.pool_id === leagueOf(p)) ?? null,
  })).sort((a, b) => (b.last?.id ?? 0) - (a.last?.id ?? 0));

  const preview = (l: Last) => {
    if (l.hidden_at) return "Message held while it's checked";
    const text = l.sticker ? (stickerLabel(l.sticker) === "Sticker" ? "Sticker" : `Sticker: ${stickerLabel(l.sticker)}`)
      : splitMentions(l.body ?? "").map((x) => ("userId" in x ? `@${names.get(x.userId!) ?? "someone"}` : x.text)).join("").trim()
        || (l.image_path ? "Photo" : "");
    const who = l.author_id === me.user_id ? "You" : names.get(l.author_id) ?? "Someone";
    return `${who}: ${l.image_path && !l.sticker && text !== "Photo" ? `📷 ${text}` : text}`;
  };

  return (
    <div className="card chatlist">
      <h2>Chats</h2>
      <ul>
        {rows.map(({ p, last, unread }) => {
          const n = unread?.unread ?? 0, at = (unread?.tagged ?? 0) > 0;
          return (
            <li key={p.id}>
              <button type="button" className={`chatrow${n ? " new" : ""}`} onClick={() => onOpen(p)}>
                {/* Every row keeps the same picture spot; a league without a picture shows a plain icon. */}
                <span className="chatrow-pic" aria-hidden="true">
                  {p.school_emis ? (
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d="M3 10 12 5l9 5M5 10v9h14v-9M10 19v-5h4v5" /></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="9" cy="9" r="3.2" /><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" /><circle cx="16.5" cy="8" r="2.6" /><path d="M16.5 13c2.2 0 3.7 1.3 4.2 3.8" /></svg>
                  )}
                  <LeaguePicture pool={p} size={46} />
                </span>
                <span className="chatrow-main">
                  <span className="chatrow-top">
                    <span className="chatrow-name"><PoolName pool={p} /></span>
                    {last && <span className="chatrow-time">{when(last.created_at)}</span>}
                  </span>
                  <span className="chatrow-bottom">
                    <span className="chatrow-last">{last ? preview(last) : "No messages yet"}</span>
                    {n > 0 && <span className={at ? "chatrow-count at" : "chatrow-count"} aria-label={at ? "You were mentioned" : `${n} unread`}>{at ? "@" : n > 99 ? "99+" : n}</span>}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
