"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLeague } from "@/components/league";
import { leagueOf } from "@/components/league-picture";
import { readCache, writeCache } from "@/lib/cache";
import { supabase } from "@/lib/supabase";
import type { Pool } from "@/lib/types";

/** Straight into a league's chat, with how many messages are waiting. */
export function ChatButton({ pool, label = "Chat" }: { pool: Pool; label?: string }) {
  const { setPool } = useLeague();
  const chat = leagueOf(pool);
  const key = `chatbtn:${chat}`;
  const [unread, setUnread] = useState<number>(() => readCache<number>(key) ?? 0);
  useEffect(() => {
    setUnread(readCache<number>(key) ?? 0);
    supabase.from("chat_unread").select("unread").eq("pool_id", chat).maybeSingle()
      .then(({ data }) => { const n = (data as { unread: number } | null)?.unread ?? 0; writeCache(key, n); setUnread(n); });
  }, [chat, key]);
  return (
    <Link href="/chat/" className="chat-btn" onClick={() => setPool(pool.id)}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12Z" />
      </svg>
      <span>{label}</span>
      {unread > 0 && <span className="chat-btn-count" aria-label={`${unread} unread`}>{unread > 99 ? "99+" : unread}</span>}
    </Link>
  );
}
