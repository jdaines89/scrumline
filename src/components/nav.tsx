"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Avatar } from "@/components/avatar";
import { Icon, type MenuItem, SideMenu } from "@/components/side-menu";
import { isBusinessSession, isSchoolSession } from "@/lib/account";
import { readCache } from "@/lib/cache";
import { supabase } from "@/lib/supabase";
import { pageKind, track } from "@/lib/track";
import type { Member } from "@/lib/types";

const TABS = [
  ["/", "Home"],
  ["/predict/", "Predict"],
  ["/leagues/", "Leagues"],
  ["/chat/", "Chat"],
  ["/fixtures/", "Matches"],
  ["/feed/", "Try\u00a0Time"],
];
const ICON: Record<string, string> = {
  "/": "home", "/predict/": "predict", "/leagues/": "leagues", "/chat/": "chat", "/fixtures/": "matches", "/feed/": "trytime",
  "/sponsor/results/": "business", "/school/": "school",
};
/** On a phone these five sit in the bar along the bottom; everything else is in the menu. */
const BAR = ["/", "/predict/", "/leagues/", "/chat/", "/fixtures/"];

/** Screens that sit under a tab without being its own address: a league's table under Leagues, the log under Matches. */
const UNDER: Record<string, string[]> = { "/leagues/": ["/leaderboard", "/rankings"], "/fixtures/": ["/standings"] };

interface Unread { count: number; tagged: boolean }

/** Messages from others across your pools since you last read each, and whether any tag you. */
function useUnread(uid: string | null): Unread {
  const [u, setU] = useState<Unread>({ count: 0, tagged: false });
  const refresh = useCallback(async () => {
    if (!uid) return;
    // Muted leagues stay out of the Chat tab's badge; "tags only" leagues add just their tags.
    const { data } = await supabase.from("chat_unread").select("unread, tagged, tags_only").eq("muted", false);
    const rows = (data ?? []) as { unread: number; tagged: number; tags_only: boolean }[];
    setU({ count: rows.reduce((n, r) => n + (r.tags_only ? r.tagged : r.unread), 0), tagged: rows.some((r) => r.tagged > 0) });
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
    supabase.rpc("my_member").maybeSingle()
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
  const schoolContact = useSchoolContact(player);
  useEffect(() => {
    if (!player) return;
    track("open");
    const k = pageKind(path);
    if (k) track(k);
  }, [player, path]);
  if (!uid) return <nav className="tabs" />;
  const out = <button type="button" className="linkish tab-out" onClick={() => supabase.auth.signOut()}>Sign out</button>;
  const asItems = (rows: [string, string, string, boolean][]): MenuItem[] => rows.map(([href, label, icon, on]) => ({ href, label, icon, on }));
  if (business) return (
    <>
    <SideMenu main={asItems([
      ["/sponsor/results/", "Your results", "business", Boolean(path?.startsWith("/sponsor/results"))],
      ["/sponsor/", "Sponsor a school", "school", Boolean(path?.startsWith("/sponsor") && !/^\/sponsor\/(profile|results|tournament|prizes)/.test(path))],
      ["/sponsor/tournament/", "Sponsor a tournament", "leagues", Boolean(path?.startsWith("/sponsor/tournament"))],
      ["/giving/", "Giving", "giving", Boolean(path?.startsWith("/giving"))],
      ["/sponsor/profile/", "Profile", "profile", Boolean(path?.startsWith("/sponsor/profile"))],
    ])} more={[]} />
    <nav className="tabs">
      <Link href="/sponsor/results/" className={path?.startsWith("/sponsor/results") ? "on" : ""}>Your results</Link>
      <Link href="/sponsor/" className={path?.startsWith("/sponsor") && !/^\/sponsor\/(profile|results|tournament|prizes)/.test(path) ? "on" : ""}>Sponsor a school</Link>
      <Link href="/sponsor/tournament/" className={path?.startsWith("/sponsor/tournament") ? "on" : ""}>Sponsor a tournament</Link>
      <Link href="/giving/" className={path?.startsWith("/giving") ? "on" : ""}>Giving</Link>
      <Link href="/sponsor/profile/" className={path?.startsWith("/sponsor/profile") ? "on" : ""}>Profile</Link>
      {out}
    </nav>
    </>
  );
  if (schoolOnly) return (
    <>
    <SideMenu main={asItems([
      ["/school/", "Your school", "school", Boolean(path?.startsWith("/school"))],
      ["/giving/", "Giving", "giving", Boolean(path?.startsWith("/giving"))],
    ])} more={[]} />
    <nav className="tabs">
      <Link href="/school/" className={path?.startsWith("/school") ? "on" : ""}>Your school</Link>
      <Link href="/giving/" className={path?.startsWith("/giving") ? "on" : ""}>Giving</Link>
      {out}
    </nav>
    </>
  );
  const tabs = [...TABS, ...(sponsors ? [["/sponsor/results/", "Business"]] : []), ...(schoolContact ? [["/school/", "School"]] : [])];
  const isOn = (href: string) => path === href || (UNDER[href] ?? []).some((u) => path?.startsWith(u)) || (href === "/sponsor/results/" && /^\/(sponsor|giving)/.test(path ?? ""));
  const badge = (href: string) => href === "/chat/" && path !== href && unread.count > 0
    ? <span className={unread.tagged ? "count at" : "count"}>{unread.tagged ? "@" : unread.count}</span> : null;
  const item = ([href, label]: string[]): MenuItem => ({ href, label: label.replace("\u00a0", " "), icon: ICON[href], on: isOn(href), badge: badge(href) });
  return (
    <>
    <SideMenu
      // The five in the bottom bar aren't listed again here.
      main={[
        ...tabs.filter(([href]) => !BAR.includes(href)).map(item),
        { href: "/achievements/", label: "Achievements", icon: "achievements", on: path === "/achievements/" },
        { href: "/giving/", label: "Giving", icon: "giving", on: Boolean(path?.startsWith("/giving")) },
        { href: "/rules/", label: "Rules", icon: "rules", on: Boolean(path?.startsWith("/rules")) },
      ]}
      more={[]} />
    <Link href="/achievements/" className={`achbtn${path === "/achievements/" ? " on" : ""}`} aria-label="Achievements">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4" />
      </svg>
    </Link>
    <Link href="/me/" className={`melink${path === "/me/" ? " on" : ""}`} aria-label="Your profile">
      {me?.avatar_path ? <Avatar member={me} size={38} /> : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
        </svg>
      )}
    </Link>
    <nav className="tabs player">
      {tabs.map(([href, label]) => (
        <Link key={href} href={href} className={isOn(href) ? "on" : ""}>
          {label}
          {badge(href)}
        </Link>
      ))}
    </nav>
    <nav className="bottombar" aria-label="Main">
      {BAR.map((href) => {
        const [, label] = TABS.find(([h]) => h === href)!;
        return (
          <Link key={href} href={href} className={isOn(href) ? "on" : ""}>
            <Icon name={ICON[href]} size={22} />
            <span>{label}</span>
            {badge(href)}
          </Link>
        );
      })}
    </nav>
    </>
  );
}
