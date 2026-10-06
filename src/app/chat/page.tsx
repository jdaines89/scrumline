"use client";

import { LeaguePicture } from "@/components/league-picture";
import { SponsorLine, usePoolSponsor } from "@/components/sponsor-line";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { Avatar } from "@/components/avatar";
import { NeedsPool, useLeague } from "@/components/league";
import { encodeMentions, splitMentions, typingTag } from "@/lib/mentions";
import { photoSize, photoUrl, rememberPhotoSize, shrinkPhoto, sizedName } from "@/lib/photo";
import { supabase } from "@/lib/supabase";
import type { ChatMessage, LeaderRow, Member } from "@/lib/types";
import { RoundRecap } from "@/components/round-recap";
import { PrizeChat } from "@/components/prize-chat";
import { usePoolPrizes, type PoolPrize } from "@/lib/prizes";
import type { PoolSponsor } from "@/lib/sponsor";
import { readCache, writeCache } from "@/lib/cache";
import { PoolName, poolLabel } from "@/components/pool-name";
import { PlayerCard } from "@/components/player-card";
import { roundName } from "@/lib/format";

const PAGE = 30;
const EMOJI = ["👍", "😂", "🔥", "😮", "😢", "🏉"];
const REASONS: [string, string][] = [["hate", "Racism or hate"], ["bullying", "Bullying"], ["sexual", "Sexual"], ["other", "Something else"]];

interface Reaction { message_id: number; user_id: string; emoji: string }
interface Notice { id: number; kind: "prize_won" | "round_recap"; round: number; winners: string[]; prize: string | null; sponsor: string | null; created_at: string }

export default function ChatPage() {
  return <NeedsPool><Chat /></NeedsPool>;
}

function Chat() {
  const { me, members: everyone, pool, pools, setPool, season, seasons, setSeason } = useLeague();
  const sponsor = usePoolSponsor();
  const poolId = pool!.id;
  // One chat per league, whichever tournament you're looking at: it lives on the league's first table.
  const chatId = pool!.league_id ?? pool!.id;
  const [inPool, setInPool] = useState<Set<string>>(new Set());
  const members = useMemo(() => everyone.filter((m) => inPool.has(m.user_id)), [everyone, inPool]);
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [profile, setProfile] = useState<Member | null>(null);
  const [pick, setPick] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const people = useMemo(() => new Map(everyone.map((m) => [m.user_id, m])), [everyone]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const idsKey = msgs.map((m) => m.id).join(",");
  const shownIds = useRef<number[]>([]);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Moderation: messages you reported are hidden for you; a chat ban shows instead of the box.
  const [reported, setReported] = useState<Set<number>>(new Set());
  const [reporting, setReporting] = useState<number | null>(null);
  const [blocking, setBlocking] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; block?: string } | null>(null);
  const [ban, setBan] = useState<string | null>(null);
  // Stay pinned to the newest message unless you've scrolled up to read.
  const atBottom = useRef(true);
  // Replying to a message, like WhatsApp: swipe a bubble right, or tap it and pick Reply.
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  // Quoted messages older than the loaded page, fetched by id (null = deleted or out of reach).
  const [quoted, setQuoted] = useState<Map<number, ChatMessage | null>>(new Map());
  const swipe = useRef<{ id: number; x: number; y: number; dx: number; el: HTMLElement; moved: boolean } | null>(null);
  const [flash, setFlash] = useState<number | null>(null);

  // Reactions for the messages on screen, refreshed whenever anyone reacts.
  const loadReactions = useCallback(async () => {
    const ids = shownIds.current;
    if (!ids.length) { setReactions([]); return; }
    const { data } = await supabase.from("chat_reactions").select("message_id, user_id, emoji").in("message_id", ids);
    setReactions((data ?? []) as Reaction[]);
  }, []);
  useEffect(() => {
    shownIds.current = idsKey ? idsKey.split(",").map(Number) : [];
    loadReactions();
  }, [idsKey, loadReactions]);
  useEffect(() => {
    const ch = supabase.channel(`reactions:${poolId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_reactions" }, () => loadReactions())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [poolId, loadReactions]);

  async function react(messageId: number, emoji: string) {
    const had = reactions.some((r) => r.message_id === messageId && r.user_id === me.user_id && r.emoji === emoji);
    setReactions((rs) => had
      ? rs.filter((r) => !(r.message_id === messageId && r.user_id === me.user_id && r.emoji === emoji))
      : [...rs, { message_id: messageId, user_id: me.user_id, emoji }]);
    setPicked(null);
    const { error } = had
      ? await supabase.from("chat_reactions").delete().eq("message_id", messageId).eq("user_id", me.user_id).eq("emoji", emoji)
      : await supabase.from("chat_reactions").insert({ message_id: messageId, emoji });
    if (error) loadReactions();
  }

  // A message handed over from another page (?say=...), ready to send or edit.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const say = q.get("say");
    if (!say) return;
    setText((t) => t || say.slice(0, 900));
    q.delete("say");
    window.history.replaceState(null, "", window.location.pathname + (q.size ? `?${q}` : ""));
    requestAnimationFrame(() => box.current?.focus());
  }, []);

  useEffect(() => {
    supabase.rpc("my_chat_ban").then(({ data }) => setBan((data as string | null) ?? null));
    supabase.from("chat_reports").select("message_id")
      .then(({ data }) => setReported(new Set((data ?? []).map((r: { message_id: number }) => r.message_id))));
  }, []);

  useEffect(() => {
    supabase.from("pool_members").select("user_id").eq("pool_id", chatId)
      .then(({ data }) => setInPool(new Set((data ?? []).map((r: { user_id: string }) => r.user_id))));
  }, [chatId]);

  const load = useCallback(async () => {
    const { data } = await supabase.from("chat_messages").select("*").eq("pool_id", chatId).order("id", { ascending: false }).limit(PAGE);
    setMsgs(((data ?? []) as ChatMessage[]).reverse());
    setMore((data ?? []).length === PAGE);
  }, [chatId]);

  // League announcements (a round prize won), shown in the log by time.
  useEffect(() => {
    setNotices([]);
    supabase.from("chat_notices").select("*").eq("pool_id", poolId).order("created_at", { ascending: false }).limit(20)
      .then(({ data }) => setNotices(((data ?? []) as Notice[]).reverse()));
    const ch = supabase.channel(`notices:${poolId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_notices", filter: `pool_id=eq.${poolId}` },
        (p) => setNotices((xs) => xs.some((x) => x.id === (p.new as Notice).id) ? xs : [...xs, p.new as Notice]))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [poolId]);

  // A round recap in the chat needs the league table and prizes; fetched only when one is showing.
  const hasRecap = notices.some((n) => n.kind === "round_recap");
  const [board, setBoard] = useState<LeaderRow[]>(() => readCache<LeaderRow[]>(`board:${poolId}`) ?? []);
  const [prizes] = usePoolPrizes(poolId);
  // Private hand-over threads this player is in: they won the prize, or offered it. Open until a month after it was due.
  const myThreads = prizes.filter((p) => p.winners?.length && (p.winners.includes(me.user_id) || p.offered_by === me.user_id)
    && (!p.due_at || Date.parse(p.due_at) + 30 * 864e5 > Date.now()));
  const [prizeChat, setPrizeChat] = useState<PoolPrize | null>(null);
  useEffect(() => {
    if (!hasRecap) return;
    supabase.from("pool_leaderboard").select("*").eq("pool_id", poolId)
      .order("total_points", { ascending: false }).order("exact_scores", { ascending: false }).order("manager")
      .then(({ data }) => { const r = (data ?? []) as LeaderRow[]; writeCache(`board:${poolId}`, r); setBoard(r); });
  }, [hasRecap, poolId]);
  const recapProps = { rows: board, prizes, sponsor, onOpen: setViewing };

  // Live: new and deleted messages arrive as they happen.
  useEffect(() => {
    load();
    const ch = supabase.channel(`chat:${chatId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `pool_id=eq.${chatId}` },
        (p) => setMsgs((xs) => xs.some((x) => x.id === (p.new as ChatMessage).id) ? xs : [...xs, p.new as ChatMessage]))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_messages", filter: `pool_id=eq.${chatId}` },
        (p) => setMsgs((xs) => xs.map((x) => x.id === (p.new as ChatMessage).id ? p.new as ChatMessage : x)))
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "chat_messages" },
        (p) => setMsgs((xs) => xs.filter((x) => x.id !== (p.old as { id: number }).id)))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load, chatId]);

  // The log fills the screen down to the message box, whatever the phone:
  // measured, not guessed.
  const form = useRef<HTMLElement>(null);
  const fitRef = useRef<() => void>(() => {});
  useEffect(() => {
    const fit = () => {
      const el = log.current, f = form.current;
      if (!el || !f) return;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      const top = el.getBoundingClientRect().top + window.scrollY;
      // With the keyboard up there's little room: let the log shrink further rather than push the box off screen.
      const least = vh < 520 ? 140 : 260;
      let h = Math.max(least, vh - top - f.offsetHeight - 24);
      el.style.height = `${h}px`;
      // Whatever still hangs below the screen (padding, the error line) comes off too,
      // so the box sits at the bottom without scrolling the page.
      const over = document.documentElement.scrollHeight - vh;
      if (over > 0) { h = Math.max(least, h - over); el.style.height = `${h}px`; }
      if (atBottom.current) el.scrollTop = el.scrollHeight;
      // Keep the message box resting on the keyboard: never leave the page scrolled past its end.
      const end = document.documentElement.scrollHeight - vh;
      if (window.scrollY > end) window.scrollTo(0, Math.max(0, end));
      else if (document.activeElement === box.current && end > 0) window.scrollTo(0, end);
    };
    fitRef.current = fit;
    fit();
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    return () => { window.removeEventListener("resize", fit); window.visualViewport?.removeEventListener("resize", fit); };
  }, []);

  useEffect(() => { fitRef.current(); }, [photo, err, ban, note, replyTo]);

  // Look up any quoted message that isn't on screen.
  const missingKey = msgs.filter((m) => m.reply_to && !msgs.some((x) => x.id === m.reply_to) && !quoted.has(m.reply_to))
    .map((m) => m.reply_to).join(",");
  useEffect(() => {
    if (!missingKey) return;
    const ids = [...new Set(missingKey.split(",").map(Number))];
    supabase.from("chat_messages").select("*").in("id", ids).then(({ data }) => setQuoted((q) => {
      const next = new Map(q);
      ids.forEach((id) => next.set(id, ((data ?? []) as ChatMessage[]).find((x) => x.id === id) ?? null));
      return next;
    }));
  }, [missingKey]);
  const findMsg = (id: number) => msgs.find((x) => x.id === id) ?? quoted.get(id) ?? null;

  // Replies need the reply_to column; until the database has it, the Reply action stays hidden.
  const canReply = msgs.some((m) => "reply_to" in m);

  function startReply(m: ChatMessage) {
    setReplyTo(m); setPicked(null);
    requestAnimationFrame(() => box.current?.focus());
  }

  // Tap a quote to jump to the message it answers (if it's loaded) and flash it.
  function jumpTo(id: number) {
    const el = log.current?.querySelector(`[data-id="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setFlash(id);
    setTimeout(() => setFlash((f) => (f === id ? null : f)), 1400);
  }

  // Swipe right on a bubble to reply. Vertical drags stay as scrolling.
  const swipeHandlers = (m: ChatMessage) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse" || !canReply) return;
      swipe.current = { id: m.id, x: e.clientX, y: e.clientY, dx: 0, el: e.currentTarget, moved: false };
    },
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
      const s = swipe.current;
      if (!s || s.id !== m.id) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (!s.moved && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { swipe.current = null; return; }
      if (dx > 8 && Math.abs(dx) > Math.abs(dy)) s.moved = true;
      if (!s.moved) return;
      s.dx = Math.max(0, Math.min(80, dx));
      s.el.style.transform = `translateX(${s.dx}px)`;
      s.el.classList.toggle("swiping", s.dx > 56);
    },
    onPointerUp: () => endSwipe(m),
    onPointerCancel: () => endSwipe(m, true),
  });
  function endSwipe(m: ChatMessage, cancel = false) {
    const s = swipe.current;
    swipe.current = null;
    if (!s || s.id !== m.id) return;
    s.el.style.transform = "";
    s.el.classList.remove("swiping");
    if (s.moved) {
      // Don't let the end of a swipe also count as a tap.
      s.el.addEventListener("click", (ev) => ev.stopPropagation(), { capture: true, once: true });
      if (!cancel && s.dx > 56) startReply(m);
    }
  }

  // The box grows with what's in it (up to its CSS max), so a longer message can be read before it's sent.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const before = el.offsetHeight;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
    if (el.offsetHeight !== before) fitRef.current();
  }, [text]);

  // Newest at the bottom, like any chat: scroll the log, not the page, and
  // again whenever something under the last message grows (reactions, photos).
  const toBottom = useCallback(() => {
    if (atBottom.current && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, []);
  useLayoutEffect(toBottom, [msgs, reactions, notices, toBottom]);
  // Things that settle after the first paint (pictures, avatars, the sponsor in
  // the header) change sizes without a scroll: keep the box fitted and pinned.
  useEffect(() => {
    const el = log.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => toBottom());
    Array.from(el.children).forEach((c) => ro.observe(c));
    const head = el.parentElement?.querySelector(".chat-head");
    const ho = new ResizeObserver(() => fitRef.current());
    if (head) ho.observe(head);
    return () => { ro.disconnect(); ho.disconnect(); };
  }, [msgs, toBottom]);
  const hasMsgs = msgs.length > 0;
  // Opening a pool always starts at the newest message, once fonts and layout have settled.
  useEffect(() => {
    atBottom.current = true;
    const again = () => { atBottom.current = true; fitRef.current(); toBottom(); };
    const t = [requestAnimationFrame(again)];
    const late = setTimeout(again, 400);
    document.fonts?.ready.then(again);
    return () => { t.forEach(cancelAnimationFrame); clearTimeout(late); };
  }, [chatId, hasMsgs, toBottom]);

  // Mark the newest read.
  const lastId = msgs.length ? msgs[msgs.length - 1].id : 0;
  useEffect(() => {
    if (lastId) {
      supabase.from("chat_reads").upsert({ user_id: me.user_id, pool_id: chatId, last_read_id: lastId }).then(() =>
        window.dispatchEvent(new Event("chat-read")));
    }
  }, [lastId, me.user_id, chatId]);

  const matches = tag === null ? [] :
    members.filter((m) => m.user_id !== me.user_id && m.display_name.toLowerCase().startsWith(tag.toLowerCase())).slice(0, 5);

  function onType(v: string) {
    setText(v);
    const cur = box.current?.selectionStart ?? v.length;
    setTag(typingTag(v.slice(0, cur)));
    setPick(0);
  }

  function choose(m: Member) {
    const cur = box.current?.selectionStart ?? text.length;
    const before = text.slice(0, cur).replace(/@[^@]*$/, `@${m.display_name} `);
    const next = before + text.slice(cur);
    setText(next); setTag(null);
    requestAnimationFrame(() => { box.current?.focus(); box.current?.setSelectionRange(before.length, before.length); });
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const body = encodeMentions(text.trim(), members);
    if ((!body && !photo) || sending) return;
    setErr(null); setSending(true);
    // Checked before anything is uploaded, so a refused message never leaves a photo behind.
    const { data: why } = await supabase.rpc("chat_check", { p_pool: chatId, p_body: body });
    if (why) {
      setSending(false); setErr(why as string);
      supabase.rpc("my_chat_ban").then(({ data }) => setBan((data as string | null) ?? null));
      return;
    }
    let image_path: string | null = null;
    if (photo) {
      image_path = `${chatId}/${me.user_id}/${await sizedName(photo.blob)}.jpg`;
      const up = await supabase.storage.from("chat-photos").upload(image_path, photo.blob, { contentType: "image/jpeg" });
      if (up.error) { setSending(false); setErr(up.error.message); return; }
    }
    const row: Record<string, unknown> = { body, pool_id: chatId };
    if (image_path) row.image_path = image_path;
    if (replyTo) row.reply_to = replyTo.id;
    const { data, error } = await supabase.from("chat_messages").insert(row).select().single();
    setSending(false);
    if (error) {
      if (image_path) supabase.storage.from("chat-photos").remove([image_path]);
      setErr(error.message); return;
    }
    setText(""); setTag(null); clearPhoto(); setReplyTo(null);
    atBottom.current = true;
    setMsgs((xs) => xs.some((x) => x.id === data.id) ? xs : [...xs, data as ChatMessage]);
  }

  async function pickPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErr(null);
    try {
      const blob = await shrinkPhoto(file);
      clearPhoto();
      setPhoto({ blob, url: URL.createObjectURL(blob) });
      box.current?.focus();
    } catch (x) {
      setErr((x as Error).message);
    }
  }

  function clearPhoto() {
    setPhoto((p) => { if (p) URL.revokeObjectURL(p.url); return null; });
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (matches.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setPick((i) => (i + 1) % matches.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setPick((i) => (i - 1 + matches.length) % matches.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(matches[pick]); return; }
      if (e.key === "Escape") { setTag(null); return; }
    }
    if (e.key === "Escape" && replyTo) { setReplyTo(null); return; }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  // Scrolled to the top: fetch the page before the oldest shown, and keep
  // the message you were looking at where it was.
  async function older() {
    if (!more || loadingOlder || !msgs.length || !log.current) return;
    setLoadingOlder(true);
    const el = log.current, before = el.scrollHeight;
    const { data } = await supabase.from("chat_messages").select("*").eq("pool_id", chatId)
      .lt("id", msgs[0].id).order("id", { ascending: false }).limit(PAGE);
    const page = ((data ?? []) as ChatMessage[]).reverse();
    setMore(page.length === PAGE);
    setMsgs((xs) => [...page, ...xs]);
    requestAnimationFrame(() => { el.scrollTop += el.scrollHeight - before; setLoadingOlder(false); });
  }

  async function remove(id: number) {
    const path = msgs.find((x) => x.id === id)?.image_path;
    const { error } = await supabase.from("chat_messages").delete().eq("id", id);
    if (!error) {
      setMsgs((xs) => xs.filter((x) => x.id !== id));
      if (path) supabase.storage.from("chat-photos").remove([path]);
    }
    setPicked(null);
  }

  // Keep the report and block prompts, and what's left after, in view inside the log.
  const reveal = useCallback((id: number) => requestAnimationFrame(() =>
    log.current?.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" })), []);
  useEffect(() => { if (picked !== null && (reporting !== null || blocking !== null)) reveal(picked); }, [picked, reporting, blocking, reveal]);

  async function report(m: ChatMessage, reason: string) {
    const { error } = await supabase.from("chat_reports").insert({ message_id: m.id, reason });
    setReporting(null); setPicked(null);
    if (error && !error.message.includes("duplicate")) { setErr(error.message); return; }
    setReported((r) => new Set(r).add(m.id));
    setNote({ text: "Thanks. It's hidden for you, and we'll look at it.", block: m.author_id });
    reveal(m.id);
  }

  async function block(userId: string) {
    const { error } = await supabase.from("member_blocks").insert({ blocked: userId });
    setBlocking(null); setPicked(null);
    if (error && !error.message.includes("duplicate")) { setErr(error.message); return; }
    setNote({ text: `You won't see ${people.get(userId)?.display_name ?? "them"} in chat any more. Unblock on your profile.` });
    load();
  }

  return (
    <div className="card chat">
      <div className="chat-head">
        {/* Which pool, and always which tournament it belongs to: two pools can share a name. */}
        <div className="chat-where">
          <label className={`chat-pool${pools.length > 1 ? "" : " one"}`}>
            <h2><LeaguePicture pool={pool!} size={28} /> <PoolName pool={pool!} /></h2>
            {pools.length > 1 && <>
              <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <select value={pool!.id} onChange={(e) => setPool(Number(e.target.value))} aria-label="Switch league">
                {pools.map((p) => <option key={p.id} value={p.id}>{poolLabel(p)}</option>)}
              </select>
            </>}
          </label>
          <label className={`chat-season${seasons.length > 1 ? "" : " one"}`}>
            <span>{season.name}</span>
            {seasons.length > 1 && <>
              <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <select value={season.id} onChange={(e) => setSeason(e.target.value)} aria-label="Switch tournament">
                {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_replay ? " (replay)" : ""}</option>)}
              </select>
            </>}
          </label>
        </div>
        <SponsorLine sponsor={sponsor} compact />
      </div>
      {myThreads.map((p) => {
        const others = p.offered_by === me.user_id ? p.winners!.filter((u) => u !== me.user_id) : [p.offered_by];
        return (
          <button key={p.round} type="button" className="pthread" onClick={() => setPrizeChat(p)}>
            <span>🏆 Private prize chat with {others.map((u) => people.get(u)?.display_name ?? "a mate").join(" & ")}</span>
            <span className="pthread-r">{roundName(p.round)} ›</span>
          </button>
        );
      })}
      {prizeChat && <PrizeChat prize={prizeChat} onClose={() => setPrizeChat(null)} />}
      <div className="chatlog" ref={log} onScroll={(e) => {
        const el = e.currentTarget;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        if (el.scrollTop < 60) older();
      }}>
        {more && <p className="muted small" style={{ textAlign: "center" }}>{loadingOlder ? "Loading older messages…" : "Scroll up for older messages"}</p>}
        {msgs.length === 0 && !notices.length && <p className="muted small">No messages yet. Start the banter.</p>}
        {msgs.length === 0 && notices.map((n) => <NoticeRow key={`n${n.id}`} n={n} me={me.user_id} people={people} recap={recapProps} />)}
        {msgs.map((m, i) => {
          // Announcements that came after the previous message and before this one (or after the last).
          const t = Date.parse(m.created_at), from = i === 0 ? (more ? t : -Infinity) : Date.parse(msgs[i - 1].created_at);
          const before = notices.filter((n) => Date.parse(n.created_at) > from && Date.parse(n.created_at) <= t);
          const after = i === msgs.length - 1 ? notices.filter((n) => Date.parse(n.created_at) > t) : [];
          const who = people.get(m.author_id);
          const mine = m.author_id === me.user_id;
          const parts = splitMentions(m.body);
          const q = m.reply_to ? findMsg(m.reply_to) : null;
          const tagsMe = parts.some((p) => "userId" in p && p.userId === me.user_id) || (!mine && q?.author_id === me.user_id);
          const grouped = i > 0 && !before.length && msgs[i - 1].author_id === m.author_id
            && new Date(m.created_at).getTime() - new Date(msgs[i - 1].created_at).getTime() < 5 * 60_000;
          return (
            <Fragment key={m.id}>
            {before.map((n) => <NoticeRow key={`n${n.id}`} n={n} me={me.user_id} people={people} recap={recapProps} />)}
            <div data-id={m.id} className={`msg${mine ? " mine" : ""}${tagsMe ? " tagged" : ""}${grouped ? " grouped" : ""}${flash === m.id ? " flash" : ""}`}>
              {!grouped && !mine && <button type="button" className="msgwho" aria-label={`${who?.display_name ?? "Player"}'s profile`} onClick={() => who && setProfile(who)}><Avatar member={who} size={28} /></button>}
              <div className="msgbody">
                {!grouped && (
                  <div className="meta">
                    {!mine && <strong>{who?.display_name ?? "Former member"}</strong>}
                    <span>{when(m.created_at)}</span>
                  </div>
                )}
                {m.hidden_at || (reported.has(m.id) && !mine) ? (
                  <div className="bubble held">
                    {m.hidden_at ? (mine ? "Your message is held while it's checked." : "Message held while it's checked.") : "You reported this message."}
                  </div>
                ) : (<>
                <div className={`bubble${picked === m.id ? " picked" : ""}${m.image_path ? " withphoto" : ""}${m.image_path && !m.body.trim() ? " photoonly" : ""}`}
                  onClick={() => setPicked(picked === m.id ? null : m.id)} {...swipeHandlers(m)}>
                  {m.reply_to && <Quote m={q} me={me.user_id} people={people} onClick={() => jumpTo(m.reply_to!)} />}
                  {m.image_path && <Photo path={m.image_path} onLoad={toBottom} onOpen={setViewing} />}
                  {m.body.trim() && <span className="btext">{parts.map((p, j) => "text" in p ? <span key={j}>{p.text}</span>
                    : <span key={j} className={`tag${p.userId === me.user_id ? " me" : ""}`}>@{people.get(p.userId)?.display_name ?? "someone"}</span>)}</span>}
                </div>
                <Reactions list={reactions.filter((r) => r.message_id === m.id)} me={me.user_id} people={people}
                  onToggle={(e) => react(m.id, e)} />
                {picked === m.id && reporting !== m.id && blocking !== m.author_id && (
                  <div className="msgactions">
                    <div className="emojipick" role="group" aria-label="React">
                      {EMOJI.map((e) => (
                        <button key={e} type="button" className="ghost" aria-label={`React ${e}`}
                          onClick={() => react(m.id, e)}>{e}</button>
                      ))}
                    </div>
                    {canReply && <button type="button" className="ghost" onClick={() => startReply(m)}>Reply</button>}
                    {mine && <button type="button" className="danger" onClick={() => remove(m.id)}>Delete</button>}
                    {!mine && <button type="button" className="ghost" onClick={() => setReporting(m.id)}>Report</button>}
                    {!mine && <button type="button" className="ghost" onClick={() => setBlocking(m.author_id)}>Block</button>}
                  </div>
                )}
                {picked === m.id && reporting === m.id && (
                  <div className="modask">
                    <span className="small muted">What&apos;s wrong with it?</span>
                    <div className="msgactions">
                      {REASONS.map(([k, label]) => <button key={k} type="button" className="ghost" onClick={() => report(m, k)}>{label}</button>)}
                      <button type="button" className="ghost" onClick={() => setReporting(null)}>Cancel</button>
                    </div>
                  </div>
                )}
                {picked === m.id && blocking === m.author_id && (
                  <div className="modask">
                    <span className="small muted">Block {who?.display_name ?? "them"}? You won&apos;t see their messages or get their tags.</span>
                    <div className="msgactions">
                      <button type="button" className="danger" onClick={() => block(m.author_id)}>Block</button>
                      <button type="button" className="ghost" onClick={() => setBlocking(null)}>Cancel</button>
                    </div>
                  </div>
                )}
                </>)}
              </div>
            </div>
            {after.map((n) => <NoticeRow key={`n${n.id}`} n={n} me={me.user_id} people={people} recap={recapProps} />)}
            </Fragment>
          );
        })}
      </div>
      {note && (
        <div className="modnote small">
          <span>{note.text}</span>
          {note.block && <button type="button" className="ghost" onClick={() => { const b = note.block!; setNote(null); block(b); }}>
            Block {people.get(note.block)?.display_name ?? "them"}</button>}
          <button type="button" className="ghost" aria-label="Close" onClick={() => setNote(null)}>OK</button>
        </div>
      )}
      {ban ? (
        <div className="composer banned" ref={form as RefObject<HTMLDivElement>}>
          <p className="small muted">{ban} Scrumline doesn&apos;t allow racism, hate or bullying.</p>
        </div>
      ) : (
      <form className="composer" onSubmit={send} ref={form as RefObject<HTMLFormElement>}>
        {matches.length > 0 && (
          <ul className="tagpick" role="listbox">
            {matches.map((m, i) => (
              <li key={m.user_id} role="option" aria-selected={i === pick} className={i === pick ? "on" : ""}
                onMouseDown={(e) => { e.preventDefault(); choose(m); }}>@{m.display_name}</li>
            ))}
          </ul>
        )}
        {replyTo && (
          <div className="replydraft">
            <Quote m={replyTo} me={me.user_id} people={people} lead="Replying to " onClick={() => jumpTo(replyTo.id)} />
            <button type="button" className="ghost" aria-label="Cancel reply" onClick={() => setReplyTo(null)}>×</button>
          </div>
        )}
        {photo && (
          <div className="photodraft">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt="Photo to send" />
            <button type="button" className="ghost" onClick={clearPhoto}>Remove</button>
          </div>
        )}
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={pickPhoto} />
        <button type="button" className="ghost photobtn" aria-label="Add a photo" disabled={sending}
          onClick={() => fileInput.current?.click()}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="5" width="18" height="14" rx="2.5" /><circle cx="12" cy="12" r="3.5" /><path d="M8 5l1.5-2h5L16 5" />
          </svg>
        </button>
        <textarea ref={box} rows={1} maxLength={900} placeholder={photo ? "Add a caption" : "Message · @ to tag"} value={text}
          onChange={(e) => onType(e.target.value)} onKeyDown={onKey} />
        <button type="submit" disabled={sending || (!text.trim() && !photo)}>{sending ? "Sending…" : "Send"}</button>
      </form>
      )}
      {viewing && (
        <div className="photoview" role="dialog" aria-label="Photo" onClick={() => setViewing(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={viewing} alt="" />
        </div>
      )}
      {err && <p className="small" style={{ color: "var(--danger)" }}>{err}</p>}
      {profile && <PlayerCard member={profile} onClose={() => setProfile(null)} />}
    </div>
  );
}

/** A chat photo, fetched through a short-lived private link. Tap to see it full size.
 *  Its space is kept from the start (the size is in the file name), so the chat doesn't jump as photos arrive. */
function Photo({ path, onLoad, onOpen }: { path: string; onLoad: () => void; onOpen: (url: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const size = useMemo(() => photoSize(path), [path]);
  useEffect(() => {
    let live = true;
    photoUrl(path).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [path]);
  const box = size ? { width: Math.round(Math.min(260, (320 * size.w) / size.h)), height: "auto", aspectRatio: `${size.w} / ${size.h}` } : undefined;
  if (!url) return <div className="photo skeleton" style={box} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="photo" src={url} alt="Photo" style={box} width={size?.w} height={size?.h}
      onLoad={(e) => { rememberPhotoSize(path, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight); onLoad(); }}
      onClick={(e) => { e.stopPropagation(); onOpen(url); }} />
  );
}

/** The message a reply answers, quoted small above it. Tap to jump to it. */
function Quote({ m, me, people, lead = "", onClick }: {
  m: ChatMessage | null; me: string; people: Map<string, Member>; lead?: string; onClick: () => void;
}) {
  if (!m || m.hidden_at) return <span className="quote gone">Message unavailable</span>;
  const who = m.author_id === me ? "You" : people.get(m.author_id)?.display_name ?? "Former member";
  const text = splitMentions(m.body).map((p) => "text" in p ? p.text : `@${people.get(p.userId)?.display_name ?? "someone"}`).join("").trim();
  return (
    <button type="button" className={`quote${m.author_id === me ? " mine" : ""}`}
      onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <strong>{lead}{who}</strong>
      <span>{m.image_path ? `📷 ${text || "Photo"}` : text}</span>
    </button>
  );
}

/** Counts under a message, one chip per emoji; yours are highlighted. Tap a chip to see who reacted. */
function Reactions({ list, me, people, onToggle }: {
  list: Reaction[]; me: string; people: Map<string, Member>; onToggle: (emoji: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (!list.length) return null;
  const name = (id: string) => id === me ? "You" : people.get(id)?.display_name ?? "Former member";
  const shown = open ? list.filter((r) => r.emoji === open) : [];
  return (
    <>
      <div className="reactions">
        {EMOJI.filter((e) => list.some((r) => r.emoji === e)).map((e) => {
          const who = list.filter((r) => r.emoji === e);
          const mine = who.some((r) => r.user_id === me);
          return (
            <button key={e} type="button" className={`rchip${mine ? " mine" : ""}${open === e ? " open" : ""}`}
              aria-expanded={open === e} onClick={(ev) => { ev.stopPropagation(); setOpen(open === e ? null : e); }}>
              {e} <span>{who.length}</span>
            </button>
          );
        })}
      </div>
      {open && shown.length > 0 && (
        <div className="rwho">
          <span>{open} {shown.map((r) => r.user_id).sort((x, y) => x === me ? -1 : y === me ? 1 : 0).map(name).join(", ")}</span>
          <button type="button" className="linkish" onClick={() => { onToggle(open); if (shown.length === 1 && shown[0].user_id === me) setOpen(null); }}>
            {shown.some((r) => r.user_id === me) ? "Remove yours" : "Add yours"}
          </button>
        </div>
      )}
    </>
  );
}

/** A league announcement: who won the round prize. */
function NoticeRow({ n, me, people, recap }: {
  n: Notice; me: string; people: Map<string, Member>;
  recap: { rows: LeaderRow[]; prizes: PoolPrize[]; sponsor: PoolSponsor | null; onOpen: (url: string) => void };
}) {
  if (n.kind === "round_recap") return <RoundRecap {...recap} round={n.round} inChat />;
  // Winners and the member who offered the prize are tagged, like a chat mention.
  const giver = recap.prizes.find((p) => p.round === n.round)?.offered_by;
  const tag = (id: string) => (
    <span key={id} className={`tag${id === me ? " me" : ""}`}>@{people.get(id)?.display_name ?? "a former member"}</span>
  );
  const ws = [...n.winners].sort((x, y) => x === me ? -1 : y === me ? 1 : 0);
  const list = ws.flatMap((id, i) => [i === 0 ? null : i === ws.length - 1 ? " and " : ", ", tag(id)]);
  const tagged = n.winners.includes(me) || giver === me;
  return (
    <div className={`notice${tagged ? " tagged" : ""}`} role="status">
      <span className="nk">{roundName(n.round)} prize 🏆</span>
      <strong>{list} {ws.length > 1 ? "share it!" : "wins it!"}</strong>
      <span className="nsub">
        {n.prize ?? ""}{n.sponsor ? ` from ${n.sponsor}` : ""}
        {giver && <> · offered by {tag(giver)}</>}
      </span>
    </div>
  );
}

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit", hour12: false,
    ...(today ? {} : { weekday: "short", day: "numeric", month: "short" }),
  });
}
