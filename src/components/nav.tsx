"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Avatar } from "@/components/avatar";
import { isBusinessSession, isSchoolSession } from "@/lib/account";
import { readCache } from "@/lib/cache";
import { supabase } from "@/lib/supabase";
import { pageKind, track } from "@/lib/track";
import type { Member } from "@/lib/types";
import { usePreview } from "@/lib/preview";

const TABS = [
  ["/", "Home"],
  ["/predict/", "Predict"],
  ["/pools/", "Leagues"],
  ["/chat/", "Chat"],
  ["/fixtures/", "Matches"],
];

/** Screens that sit under a tab without being its own address: a league's table under Leagues, the log under Matches. */
const UNDER: Record<string, string[]> = { "/pools/": ["/leaderboard"], "/fixtures/": ["/standings"] };

interface Unread { count: number; tagged: boolean }

/** Messages from others across your pools since you last read each, and whether any tag you. */
function useUnread(uid: string | null): Unread {
  const [u, setU] = useState<Unread>({ count: 0, tagged: false });
  const refresh = useCallback(async () => {
    if (!uid) return;
    const { data } = await supabase.from("chat_unread").select("unread, tagged");
    const rows = (data ?? []) as { unread: number; tagged: number }[];
    setU({ count: rows.reduce((n, r) => n + r.unread, 0), tagged: rows.some((r) => r.tagged > 0) });
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    refresh();
    const ch = supabase.channel("chat-badge")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, () => refresh())
      .subscribe();
    window.addEventListener("chat-read", refresh);
    return () => { supabase.removeChannel(ch); window.removeEventListener("chat-read", refresh); };
  }, [uid, refresh]);
  return u;
}

/** Whether this player also runs a sponsoring business, for the Business tab. */
function useSponsors(uid: string | null): boolean {
  const [has, setHas] = useState(false);
  useEffect(() => {
    if (!uid) { setHas(false); return; }
    try { setHas(localStorage.getItem(`sl:sponsor:${uid}`) === "1"); } catch { /* no storage */ }
    supabase.from("sponsors").select("id").limit(1).then(({ data }) => {
      const yes = Boolean(data?.length);
      setHas(yes);
      try { localStorage.setItem(`sl:sponsor:${uid}`, yes ? "1" : "0"); } catch { /* no storage */ }
    });
  }, [uid]);
  return has;
}

/** Whether this player also looks after their school's account, for the School tab. */
function useSchoolContact(uid: string | null): boolean {
  const [has, setHas] = useState(false);
  useEffect(() => {
    if (!uid) { setHas(false); return; }
    try { setHas(localStorage.getItem(`sl:schoolacct:${uid}`) === "1"); } catch { /* no storage */ }
    supabase.from("school_accounts").select("user_id").limit(1).then(({ data }) => {
      const yes = Boolean(data?.length);
      setHas(yes);
      try { localStorage.setItem(`sl:schoolacct:${uid}`, yes ? "1" : "0"); } catch { /* no storage */ }
    });
  }, [uid]);
  return has;
}

/** You, for the picture in the corner: last visit's copy first, then the database's. */
function useMe(uid: string | null): Member | undefined {
  const [me, setMe] = useState<Member | undefined>();
  useEffect(() => {
    if (!uid) { setMe(undefined); return; }
    const cached = readCache<{ me: Member }>("base")?.me;
    if (cached?.user_id === uid) setMe(cached);
    supabase.from("members").select("*").eq("user_id", uid).maybeSingle()
      .then(({ data }) => { if (data) setMe(data as Member); });
  }, [uid]);
  return me;
}

export function Nav() {
  const path = usePathname();
  const [uid, setUid] = useState<string | null>(null);
  const [business, setBusiness] = useState(false);
  const [schoolOnly, setSchoolOnly] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setUid(data.session?.user.id ?? null); setBusiness(isBusinessSession(data.session)); setSchoolOnly(isSchoolSession(data.session)); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => { setUid(s?.user.id ?? null); setBusiness(isBusinessSession(s)); setSchoolOnly(isSchoolSession(s)); });
    return () => data.subscription.unsubscribe();
  }, []);
  const player = business || schoolOnly ? null : uid;
  const unread = useUnread(player);
  const me = useMe(player);
  const sponsors = useSponsors(player);
  const preview = usePreview();
  const schoolContact = useSchoolContact(player);
  useEffect(() => {
    if (!player) return;
    track("open");
    const k = pageKind(path);
    if (k) track(k);
  }, [player, path]);
  if (!uid) return <nav className="tabs" />;
  if (business) return (
    <nav className="tabs">
      <Link href="/sponsor/results/" className={path?.startsWith("/sponsor/results") ? "on" : ""}>Your results</Link>
      <Link href="/sponsor/" className={path?.startsWith("/sponsor") && !/^\/sponsor\/(profile|results|tournament|prizes)/.test(path) ? "on" : ""}>Sponsor a school</Link>
      <Link href="/sponsor/tournament/" className={path?.startsWith("/sponsor/tournament") ? "on" : ""}>Sponsor a tournament</Link>
      <Link href="/giving/" className={path?.startsWith("/giving") ? "on" : ""}>Giving</Link>
      <Link href="/sponsor/profile/" className={path?.startsWith("/sponsor/profile") ? "on" : ""}>Profile</Link>
      <button type="button" className="linkish tab-out" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </nav>
  );
  if (schoolOnly) return (
    <nav className="tabs">
      <Link href="/school/" className={path?.startsWith("/school") ? "on" : ""}>Your school</Link>
      <Link href="/giving/" className={path?.startsWith("/giving") ? "on" : ""}>Giving</Link>
      <button type="button" className="linkish tab-out" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </nav>
  );
  return (
    <>
    <Link href="/me/" className={`melink${path === "/me/" ? " on" : ""}`} aria-label="Your profile">
      {me?.avatar_path ? <Avatar member={me} size={38} /> : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
        </svg>
      )}
    </Link>
    <nav className="tabs">
      {[...TABS, ...(sponsors || preview ? [["/sponsor/results/", "Business"]] : []), ...(schoolContact ? [["/school/", "School"]] : [])].map(([href, label]) => (
        <Link key={href} href={href} className={path === href || (UNDER[href] ?? []).some((u) => path?.startsWith(u)) || (href === "/sponsor/results/" && /^\/(sponsor|giving)/.test(path ?? "")) ? "on" : ""}>
          {label}
          {href === "/chat/" && path !== href && unread.count > 0 &&
            <span className={unread.tagged ? "count at" : "count"}>{unread.tagged ? "@" : unread.count}</span>}
        </Link>
      ))}
    </nav>
    </>
  );
}
