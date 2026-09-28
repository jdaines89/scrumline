"use client";

import { SponsorLine, usePoolSponsor } from "@/components/sponsor-line";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import { Avatar } from "@/components/avatar";
import { NeedsPool, useLeague } from "@/components/league";
import { encodeMentions, splitMentions, typingTag } from "@/lib/mentions";
import { photoUrl, shrinkPhoto } from "@/lib/photo";
import { supabase } from "@/lib/supabase";
import type { ChatMessage, Member } from "@/lib/types";
import { PoolName } from "@/components/pool-name";

const PAGE = 30;
const EMOJI = ["👍", "😂", "🔥", "😮", "😢", "🏉"];

interface Reaction { message_id: number; user_id: string; emoji: string }

export default function ChatPage() {
  return <NeedsPool><ChatOrClass /></NeedsPool>;
}

// A whole-school pool is too big to talk in; its chat lives in the class pools.
function ChatOrClass() {
  const { pool, pools, setPool } = useLeague();
  if (!pool!.school_emis || pool!.school_year) return <Chat />;
  const classPool = pools.find((p) => p.school_emis === pool!.school_emis && p.school_stage === pool!.school_stage && p.school_year);
  return (
    <div className="card nochat">
      <h2><PoolName pool={pool!} /></h2>
      <p className="sub">The whole school is too many people for one chat, so the talk happens in each class&apos;s pool.</p>
      {classPool ? (
        <button type="button" onClick={() => setPool(classPool.id)}>Go to {classPool.name}</button>
      ) : (
        <p className="muted">Add the year you finished school on your profile and you&apos;ll join your class pool.</p>
      )}
    </div>
  );
}

function Chat() {
  const { me, members: everyone, pool } = useLeague();
  const sponsor = usePoolSponsor();
  const poolId = pool!.id;
  const [inPool, setInPool] = useState<Set<string>>(new Set());
  const members = useMemo(() => everyone.filter((m) => inPool.has(m.user_id)), [everyone, inPool]);
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [pick, setPick] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const people = useMemo(() => new Map(everyone.map((m) => [m.user_id, m])), [everyone]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const idsKey = msgs.map((m) => m.id).join(",");
  const shownIds = useRef<number[]>([]);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Stay pinned to the newest message unless you've scrolled up to read.
  const atBottom = useRef(true);

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

  useEffect(() => {
    supabase.from("pool_members").select("user_id").eq("pool_id", poolId)
      .then(({ data }) => setInPool(new Set((data ?? []).map((r: { user_id: string }) => r.user_id))));
  }, [poolId]);

  const load = useCallback(async () => {
    const { data } = await supabase.from("chat_messages").select("*").eq("pool_id", poolId).order("id", { ascending: false }).limit(PAGE);
    setMsgs(((data ?? []) as ChatMessage[]).reverse());
    setMore((data ?? []).length === PAGE);
  }, [poolId]);

  // Live: new and deleted messages arrive as they happen.
  useEffect(() => {
    load();
    const ch = supabase.channel(`chat:${poolId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `pool_id=eq.${poolId}` },
        (p) => setMsgs((xs) => xs.some((x) => x.id === (p.new as ChatMessage).id) ? xs : [...xs, p.new as ChatMessage]))
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "chat_messages" },
        (p) => setMsgs((xs) => xs.filter((x) => x.id !== (p.old as { id: number }).id)))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load, poolId]);

  // The log fills the screen down to the message box, whatever the phone:
  // measured, not guessed.
  const form = useRef<HTMLFormElement>(null);
  const fitRef = useRef<() => void>(() => {});
  useEffect(() => {
    const fit = () => {
      const el = log.current, f = form.current;
      if (!el || !f) return;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      const top = el.getBoundingClientRect().top + window.scrollY;
      let h = Math.max(260, vh - top - f.offsetHeight - 24);
      el.style.height = `${h}px`;
      // Whatever still hangs below the screen (padding, the error line) comes off too,
      // so the box sits at the bottom without scrolling the page.
      const over = document.documentElement.scrollHeight - vh;
      if (over > 0) { h = Math.max(260, h - over); el.style.height = `${h}px`; }
      if (atBottom.current) el.scrollTop = el.scrollHeight;
    };
    fitRef.current = fit;
    fit();
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    return () => { window.removeEventListener("resize", fit); window.visualViewport?.removeEventListener("resize", fit); };
  }, []);

  useEffect(() => { fitRef.current(); }, [photo, err]);

  // Newest at the bottom, like any chat: scroll the log, not the page, and
  // again whenever something under the last message grows (reactions, photos).
  const toBottom = useCallback(() => {
    if (atBottom.current && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, []);
  useLayoutEffect(toBottom, [msgs, reactions, toBottom]);

  // Mark the newest read.
  const lastId = msgs.length ? msgs[msgs.length - 1].id : 0;
  useEffect(() => {
    if (lastId) {
      supabase.from("chat_reads").upsert({ user_id: me.user_id, pool_id: poolId, last_read_id: lastId }).then(() =>
        window.dispatchEvent(new Event("chat-read")));
    }
  }, [lastId, me.user_id, poolId]);

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
    let image_path: string | null = null;
    if (photo) {
      image_path = `${poolId}/${me.user_id}/${crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from("chat-photos").upload(image_path, photo.blob, { contentType: "image/jpeg" });
      if (up.error) { setSending(false); setErr(up.error.message); return; }
    }
    const { data, error } = await supabase.from("chat_messages")
      .insert(image_path ? { body, pool_id: poolId, image_path } : { body, pool_id: poolId }).select().single();
    setSending(false);
    if (error) {
      if (image_path) supabase.storage.from("chat-photos").remove([image_path]);
      setErr(error.message); return;
    }
    setText(""); setTag(null); clearPhoto();
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
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  // Scrolled to the top: fetch the page before the oldest shown, and keep
  // the message you were looking at where it was.
  async function older() {
    if (!more || loadingOlder || !msgs.length || !log.current) return;
    setLoadingOlder(true);
    const el = log.current, before = el.scrollHeight;
    const { data } = await supabase.from("chat_messages").select("*").eq("pool_id", poolId)
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

  return (
    <div className="card chat">
      <h2><PoolName pool={pool!} /></h2>
      <SponsorLine sponsor={sponsor} />
      <div className="chatlog" ref={log} onScroll={(e) => {
        const el = e.currentTarget;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        if (el.scrollTop < 60) older();
      }}>
        {more && <p className="muted small" style={{ textAlign: "center" }}>{loadingOlder ? "Loading older messages…" : "Scroll up for older messages"}</p>}
        {msgs.length === 0 && <p className="muted small">No messages yet. Start the banter.</p>}
        {msgs.map((m, i) => {
          const who = people.get(m.author_id);
          const mine = m.author_id === me.user_id;
          const parts = splitMentions(m.body);
          const tagsMe = parts.some((p) => "userId" in p && p.userId === me.user_id);
          const grouped = i > 0 && msgs[i - 1].author_id === m.author_id
            && new Date(m.created_at).getTime() - new Date(msgs[i - 1].created_at).getTime() < 5 * 60_000;
          return (
            <div key={m.id} className={`msg${mine ? " mine" : ""}${tagsMe ? " tagged" : ""}${grouped ? " grouped" : ""}`}>
              {!grouped && !mine && <Avatar member={who} />}
              <div className="msgbody">
                {!grouped && (
                  <div className="meta">
                    {!mine && <strong>{who?.display_name ?? "Former member"}</strong>}
                    <span>{when(m.created_at)}</span>
                  </div>
                )}
                <div className={`bubble${picked === m.id ? " picked" : ""}${m.image_path ? " withphoto" : ""}${m.image_path && !m.body.trim() ? " photoonly" : ""}`}
                  onClick={() => setPicked(picked === m.id ? null : m.id)}>
                  {m.image_path && <Photo path={m.image_path} onLoad={toBottom} onOpen={setViewing} />}
                  {m.body.trim() && <span className="btext">{parts.map((p, j) => "text" in p ? <span key={j}>{p.text}</span>
                    : <span key={j} className={`tag${p.userId === me.user_id ? " me" : ""}`}>@{people.get(p.userId)?.display_name ?? "someone"}</span>)}</span>}
                </div>
                <Reactions list={reactions.filter((r) => r.message_id === m.id)} me={me.user_id} people={people}
                  onToggle={(e) => react(m.id, e)} />
                {picked === m.id && (
                  <div className="msgactions">
                    <div className="emojipick" role="group" aria-label="React">
                      {EMOJI.map((e) => (
                        <button key={e} type="button" className="ghost" aria-label={`React ${e}`}
                          onClick={() => react(m.id, e)}>{e}</button>
                      ))}
                    </div>
                    {mine && <button type="button" className="danger" onClick={() => remove(m.id)}>Delete</button>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <form className="composer" onSubmit={send} ref={form}>
        {matches.length > 0 && (
          <ul className="tagpick" role="listbox">
            {matches.map((m, i) => (
              <li key={m.user_id} role="option" aria-selected={i === pick} className={i === pick ? "on" : ""}
                onMouseDown={(e) => { e.preventDefault(); choose(m); }}>@{m.display_name}</li>
            ))}
          </ul>
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
      {viewing && (
        <div className="photoview" role="dialog" aria-label="Photo" onClick={() => setViewing(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={viewing} alt="" />
        </div>
      )}
      {err && <p className="small" style={{ color: "var(--danger)" }}>{err}</p>}
    </div>
  );
}

/** A chat photo, fetched through a short-lived private link. Tap to see it full size. */
function Photo({ path, onLoad, onOpen }: { path: string; onLoad: () => void; onOpen: (url: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    photoUrl(path).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [path]);
  if (!url) return <div className="photo skeleton" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="photo" src={url} alt="Photo" onLoad={onLoad}
      onClick={(e) => { e.stopPropagation(); onOpen(url); }} />
  );
}

/** Counts under a message, one chip per emoji; yours are highlighted and tapping toggles. */
function Reactions({ list, me, people, onToggle }: {
  list: Reaction[]; me: string; people: Map<string, Member>; onToggle: (emoji: string) => void;
}) {
  if (!list.length) return null;
  return (
    <div className="reactions">
      {EMOJI.filter((e) => list.some((r) => r.emoji === e)).map((e) => {
        const who = list.filter((r) => r.emoji === e);
        const mine = who.some((r) => r.user_id === me);
        return (
          <button key={e} type="button" className={`rchip${mine ? " mine" : ""}`} onClick={() => onToggle(e)}
            title={who.map((r) => r.user_id === me ? "You" : people.get(r.user_id)?.display_name ?? "Someone").join(", ")}>
            {e} <span>{who.length}</span>
          </button>
        );
      })}
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
