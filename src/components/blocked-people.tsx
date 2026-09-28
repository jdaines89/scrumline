"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Member } from "@/lib/types";

/** People you've blocked in chat, with a way back. Shows nothing until you block someone. */
export function BlockedPeople({ members }: { members: Member[] }) {
  const [blocked, setBlocked] = useState<string[]>([]);
  useEffect(() => {
    supabase.from("member_blocks").select("blocked")
      .then(({ data }) => setBlocked((data ?? []).map((r: { blocked: string }) => r.blocked)));
  }, []);

  async function unblock(id: string) {
    const { error } = await supabase.from("member_blocks").delete().eq("blocked", id);
    if (!error) setBlocked((b) => b.filter((x) => x !== id));
  }

  if (!blocked.length) return null;
  const name = (id: string) => members.find((m) => m.user_id === id)?.display_name ?? "Former member";
  return (
    <div className="card">
      <h2>Blocked</h2>
      <p className="sub">You don&apos;t see their chat messages or get their tags.</p>
      {blocked.map((id, i) => (
        <div key={id} className={`rowline${i === 0 ? " first" : ""}`}>
          <span>{name(id)}</span>
          <button type="button" className="ghost" onClick={() => unblock(id)}>Unblock</button>
        </div>
      ))}
    </div>
  );
}
