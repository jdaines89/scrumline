"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLeague } from "@/components/league";
import { readCache, writeCache } from "@/lib/cache";
import { encodeMentions, splitMentions, typingTag } from "@/lib/mentions";
import { provinceName, schoolHref } from "@/lib/crest";
import { projectPhotoUrl } from "@/lib/projects";
import { Tabs } from "@/components/tabs";
import { ShareMomentButton } from "@/components/share-moment";
import type { Moment } from "@/lib/share-moments";
import { supabase } from "@/lib/supabase";
import { STATIC, TRIAL_BACKERS, TRIAL_FACTS, useTrialFeed } from "@/lib/trial-projects";

const EMOJI = ["👍", "🔥", "🏉", "😮", "😢", "😂"];
const PAGE = 20;
const REASONS: [string, string][] = [["hate", "Hateful"], ["bullying", "Bullying"], ["sexual", "Sexual"], ["other", "Something else"]];

interface Item {
  project_id: number; post_key: string; at: string; event: string; emis: string; school: string; town: string | null;
  province: string; title: string; note: string | null; image_path: string | null;
  reactions: Record<string, number>; mine: string[]; comments: number; trial?: true;
}
interface Facts { project_id: number; items: string; target_minor: number; pledged_minor: number; backers: number; learners: number | null }
interface Comment {
  id: number; author_id: string; author_name: string | null; body: string; created_at: string; mine: boolean;
  reply_to?: number | null; reactions?: Record<string, number>; my_reaction?: string | null;
}
/** Quick emoji for a comment: the phone's own keyboard works too, this is one tap away. */
const COMMENT_EMOJI = ["😀", "😂", "🔥", "👏", "🏉", "💪", "🙌", "❤️"];

/** "5 min ago", "3 h ago", "2 d ago", else the date. */
/** A post's photo: shipped with the app (trial posts) or from storage. */
const photoUrl = (path: string) => path.startsWith(STATIC) ? Promise.resolve(path.slice(STATIC.length)) : projectPhotoUrl(path);

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

/** The stamped word on a post. */
const STAMP: Record<string, string> = { opened: "New project", funded: "Fully backed", order: "Ordered", delivery: "Delivered", note: "Update" };
const rands = (minor: number) => `R${Math.round(minor / 100).toLocaleString("en-ZA")}`;
/** Learner numbers come from a government list that is a year or so old, so only a rough figure is shown. */
const aboutLearners = (n: number) => { const step = n < 100 ? 10 : n < 1000 ? 100 : 500; return `~${Math.max(step, Math.round(n / step) * step).toLocaleString("en-ZA")}`; };

/** Where a project is now, from its newest post that moves it along. */
type Stage = "fundraising" | "progress" | "delivered";
type StageFilter = "all" | Stage;
const STAGE_OF: Record<string, Stage> = { opened: "fundraising", funded: "progress", order: "progress", delivery: "delivered" };
const STAGE_TABS = [["all", "All"], ["fundraising", "Fundraising"], ["progress", "In progress"], ["delivered", "Delivered"]] as const;

/** The picture for a post: only real figures, and a trial post carries none. */
function shareMoment(it: Item, facts?: Facts, photo?: string | null): Moment {
  const word = (STAMP[it.event] ?? "Update");
  const fig = moneyLine(it, facts);
  const stat = facts ? (it.event === "opened" && facts.pledged_minor < facts.target_minor ? `${rands(facts.pledged_minor)} of ${rands(facts.target_minor)}` : rands(facts.pledged_minor)) : undefined;
  const label = facts ? (it.event === "opened" ? "backed so far" : `from ${facts.backers} ${facts.backers === 1 ? "backer" : "backers"}`) : undefined;
  return {
    kind: "project", kicker: word, stamp: word, example: !!it.trial, over: it.school, headline: it.title,
    stat, statLabel: label, said: "", photo: photo ?? undefined, items: facts?.items, facts: fig || undefined,
    detail: `${it.school}${it.town ? `, ${it.town}` : ""}${it.trial ? " (an example project)" : ""}${facts?.items ? `. ${facts.items}` : ""}${fig ? `. ${fig}` : ""}.`,
  };
}

/**
 * Over the Line: project events, newest first. One school's, one
 * province's, or the whole country's. Every post is a project event, so nothing
 * floats loose, and reactions and comments follow the chat rules.
 */
export function SchoolFeed({ emis, province, empty, filters }: { emis?: string; province?: string; empty?: string; filters?: boolean }) {
  const { me } = useLeague();
  const key = `feed1:${emis ?? ""}:${province ?? ""}`;
  const [items, setItems] = useState<Item[] | null>(() => readCache<Item[]>(key) ?? null);
  const [more, setMore] = useState(true);
  const [busy, setBusy] = useState(false);
  const [facts, setFacts] = useState<Record<number, Facts>>({});
  const trialRaw = useTrialFeed(emis, province);
  const [trialState, setTrialState] = useState<Record<string, { reactions: Record<string, number>; mine: string[]; comments: number }>>({});
  const [stage, setStage] = useState<StageFilter>("all");
  // Trial posts carry what players have really done on them (reactions, comments), kept in the feed tables.
  useEffect(() => {
    if (!trialRaw.length) return;
    supabase.rpc("feed_trial_state").then(({ data }) => {
      if (!data) return;
      setTrialState(Object.fromEntries((data as { project_id: number; post_key: string; reactions: Record<string, number>; mine: string[]; comments: number }[])
        .map((r) => [`${r.project_id}:${r.post_key}`, r])));
    });
  }, [trialRaw.length]);
  const trial = useMemo(() => trialRaw.map((t) => {
    const st = trialState[`${t.project_id}:${t.post_key}`];
    return st ? { ...t, reactions: st.reactions, mine: st.mine, comments: st.comments } : t;
  }), [trialRaw, trialState]);

  const load = useCallback(async (before?: string) => {
    const { data, error } = await supabase.rpc("school_feed", {
      p_emis: emis ?? null, p_province: province ?? null, p_before: before ?? null, p_limit: PAGE,
    });
    if (error) return;
    const rows = (data ?? []) as Item[];
    setMore(rows.length === PAGE);
    const ids = [...new Set(rows.map((r) => r.project_id))];
    if (ids.length) {
      supabase.rpc("feed_project_facts", { p_projects: ids }).then(({ data: f }) => {
        if (f) setFacts((cur) => ({ ...cur, ...Object.fromEntries((f as Facts[]).map((x) => [x.project_id, x])) }));
      });
    }
    setItems((cur) => {
      const next = before ? [...(cur ?? []), ...rows] : rows;
      if (!before) writeCache(key, next);
      return next;
    });
  }, [emis, province, key]);

  useEffect(() => { setItems(readCache<Item[]>(key) ?? null); setMore(true); load(); }, [key, load]);

  // A project's stage is its newest post that moves it along; posts arrive newest first. A tab shows the projects at that stage and only the posts that belong to it, so an old "New project" post never sits under Delivered.
  const shown = items && (trial.length ? [...items, ...trial.filter((t) => !more || !items.length || t.at >= items[items.length - 1].at)].sort((a, b) => b.at.localeCompare(a.at)) : items);
  const stageOf = new Map<number, Stage>();
  for (const it of shown ?? []) if (STAGE_OF[it.event] && !stageOf.has(it.project_id)) stageOf.set(it.project_id, STAGE_OF[it.event]);
  // One project is one story: its posts collapse into one card led by the newest post, with the earlier ones as a stage line.
  const groups: { lead: Item; history: Item[] }[] = [];
  const at = new Map<number, number>();
  for (const it of shown ?? []) {
    const g = at.get(it.project_id);
    if (g === undefined) { at.set(it.project_id, groups.length); groups.push({ lead: it, history: [] }); } else groups[g].history.push(it);
  }
  const visible = shown && (stage === "all" ? groups : groups.filter((g) => stageOf.get(g.lead.project_id) === stage));

  // A filter can leave a page nearly empty while older posts wait: fetch on until there is something to see.
  useEffect(() => {
    if (!items || busy || !more || stage === "all" || (visible?.length ?? 0) >= 4) return;
    setBusy(true); load(items[items.length - 1].at).finally(() => setBusy(false));
  }, [items, busy, more, stage, visible?.length, load]);

  if (!items || !shown || !visible) return <div className="skeleton" style={{ height: 200 }} />;
  if (!shown.length) return <p className="sub" style={{ margin: 0 }}>{empty ?? "Nothing yet. When a project opens or arrives at a school, it shows up here."}</p>;
  return (
    <div className="feed">
      {filters && <div className="feed-tabs"><Tabs label="Project status" items={STAGE_TABS} value={stage} onPick={setStage} size="sub" /></div>}
      {!visible.length && !more && <p className="sub" style={{ margin: 0 }}>No projects here yet.</p>}
      {visible.map((g) => <FeedCard key={g.lead.project_id} it={g.lead} history={g.history} me={me.user_id} showSchool={!emis} facts={facts[g.lead.project_id] ?? TRIAL_FACTS[g.lead.project_id]} />)}
      {more && (
        <button type="button" className="ghost feed-more" disabled={busy}
          onClick={async () => { setBusy(true); await load(items[items.length - 1].at); setBusy(false); }}>
          {busy ? "Loading…" : "Show more"}
        </button>
      )}
    </div>
  );
}

/** The money line for where a project stands: still raising shows goal progress, anything later shows the final amount. */
function moneyLine(it: Item, facts?: Facts): string {
  if (!facts || facts.backers < 1) return "";
  const who = `${facts.backers} ${facts.backers === 1 ? "backer" : "backers"}`;
  return it.event === "opened" && facts.pledged_minor < facts.target_minor
    ? `${rands(facts.pledged_minor)} of ${rands(facts.target_minor)} from ${who}`
    : `${rands(facts.pledged_minor)} from ${who}`;
}

/** Cheer, comments, share and reactions for one post: used by a project's newest post and by each earlier post in its story. */
function Engage({ it, me, facts, url }: { it: Item; me: string; facts?: Facts; url: string | null }) {
  const [mine, setMine] = useState<string[]>(it.mine);
  const [counts, setCounts] = useState<Record<string, number>>(it.reactions);
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [total, setTotal] = useState(it.comments);
  // Counts can arrive after the card is drawn (trial posts): take them in when they change.
  const sync = JSON.stringify([it.reactions, it.mine, it.comments]);
  useEffect(() => { setMine(it.mine); setCounts(it.reactions); setTotal(it.comments); }, [sync]); // eslint-disable-line react-hooks/exhaustive-deps

  // One reaction per player per post: tapping another swaps it, tapping the same takes it off.
  async function react(e: string) {
    const on = mine.includes(e);
    const prev = mine[0];
    const next = { ...counts };
    if (prev) next[prev] = Math.max(0, (next[prev] ?? 0) - 1);
    if (!on) next[e] = (next[e] ?? 0) + 1;
    setMine(on ? [] : [e]); setCounts(next);
    const t = supabase.from("feed_reactions");
    const key = { project_id: it.project_id, post_key: it.post_key, user_id: me };
    let error: { message: string } | null = null;
    if (prev) ({ error } = await t.delete().match({ ...key, emoji: prev }));
    if (!error && !on) ({ error } = await t.insert({ ...key, emoji: e }));
    if (error && !error.message.includes("duplicate")) { setMine(it.mine); setCounts(it.reactions); }
  }

  const others = EMOJI.filter((e) => e !== "🔥");
  return (
    <>
      <div className="feed-actions">
        <button type="button" className={`cheer${mine.includes("🔥") ? " mine" : ""}`} aria-pressed={mine.includes("🔥")} onClick={() => react("🔥")}>
          🔥 Cheer{(counts["🔥"] ?? 0) > 0 && <span>{counts["🔥"]}</span>}
        </button>
        <button type="button" className="fa" aria-expanded={open} aria-label="Comments" onClick={() => setOpen(!open)}>
          💬{total > 0 && <span>{total}</span>}
        </button>
        <ShareMomentButton moment={shareMoment(it, facts, url)} label="Share" />
      </div>
      <div className="feed-react">
        {others.filter((e) => more || (counts[e] ?? 0) > 0).map((e) => (
          <button key={e} type="button" className={mine.includes(e) ? "mine" : ""} aria-pressed={mine.includes(e)} onClick={() => react(e)}>
            {e}{(counts[e] ?? 0) > 0 && <span>{counts[e]}</span>}
          </button>
        ))}
        <button type="button" className="feed-addr" aria-expanded={more} onClick={() => setMore(!more)}>{more ? "Done" : "☺ React"}</button>
      </div>
      {open && <Comments it={it} onCount={setTotal} />}
    </>
  );
}

/** An earlier post of the same project: one tappable line with its engagement, opening to its photo, words, cheers and comments. */
function StoryPost({ it, me, facts }: { it: Item; me: string; facts?: Facts }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { if (open && it.image_path) photoUrl(it.image_path).then(setUrl); }, [open, it.image_path]);
  const cheers = Object.values(it.reactions).reduce((n, c) => n + c, 0);
  return (
    <li className="feed-past">
      <button type="button" className="feed-past-row" aria-expanded={open} onClick={() => setOpen(!open)}>
        <b>{STAMP[it.event] ?? "Update"}</b><span>{ago(it.at).replace(/ 20\d\d$/, "")}</span>
        {cheers > 0 && <span>{cheers} {cheers === 1 ? "reaction" : "reactions"}</span>}{it.comments > 0 && <span>{it.comments} {it.comments === 1 ? "comment" : "comments"}</span>}
        <i>{open ? "⌃" : "›"}</i>
      </button>
      {open && (
        <div className="feed-past-body">
          {it.image_path && (url ? <img src={url} alt={it.note ?? it.title} /> : <div className="skeleton" style={{ height: 160 }} />)}
          {it.note && <p className="feed-note">{it.note}</p>}
          <Engage it={it} me={me} facts={facts} url={url} />
        </div>
      )}
    </li>
  );
}

function FeedCard({ it, history, me, showSchool, facts }: { it: Item; history: Item[]; me: string; showSchool: boolean; facts?: Facts }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { if (it.image_path) photoUrl(it.image_path).then(setUrl); }, [it.image_path]);

  const stamp = STAMP[it.event] ?? "Update";
  const place = [it.town, provinceName(it.province)].filter(Boolean).join(", ");
  const where = [place, facts?.learners ? `${aboutLearners(facts.learners)} learners` : null].filter(Boolean).join(" · ");
  const facts_line = moneyLine(it, facts);

  return (
    <article className={`feed-card${it.image_path ? " has-photo" : ""}`}>
      {it.image_path ? (
        <div className="feed-hero">
          {url ? <img src={url} alt={it.note ?? it.title} /> : <div className="skeleton feed-hero-skel" />}
          <span className="feed-stamp">{stamp}</span>
          <div className="feed-hero-foot">
            {showSchool
              ? <Link href={schoolHref(it.emis)}><b>{it.school}</b><span>{where}</span></Link>
              : <span><b>{it.title}</b></span>}
          </div>
        </div>
      ) : (
        <header className="feed-head">
          <span className="feed-stamp flat">{stamp}</span>
          {showSchool && <Link href={schoolHref(it.emis)} className="feed-school"><b>{it.school}</b><span className="small muted">{where}</span></Link>}
        </header>
      )}
      <div className="feed-body">
        <p className="feed-when small muted">{ago(it.at)}{it.trial && <span className="trial-tag">Trial</span>}</p>
        <p className="feed-title"><b>{it.title}</b></p>
        {it.note && <p className="feed-note">{it.note}</p>}
        {facts?.items && <p className="feed-facts">{facts.items}</p>}
        {facts_line && <Backers it={it} line={facts_line} canOpen={(facts?.backers ?? 0) > 0} />}
        <Engage it={it} me={me} facts={facts} url={url} />
        {history.length > 0 && (
          <ul className="feed-story" aria-label="Earlier in this project">
            {history.map((h) => <StoryPost key={h.post_key} it={h} me={me} facts={facts} />)}
          </ul>
        )}
      </div>
    </article>
  );
}

interface Backer { name: string; business: boolean; amount_minor: number; status?: string }

/** "R85,000 from 7 backers ›": tap to see who gave what. Names are the ones the projects page already shows signed-in players. */
function Backers({ it, line, canOpen }: { it: Item; line: string; canOpen: boolean }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Backer[] | null>(null);
  async function toggle() {
    const next = !open; setOpen(next);
    if (!next || list) return;
    if (it.trial) { setList(TRIAL_BACKERS[it.project_id] ?? []); return; }
    const { data } = await supabase.rpc("school_projects_list");
    const p = ((data ?? []) as { id: number; backers: (Backer & { status: string })[] }[]).find((r) => r.id === it.project_id);
    setList((p?.backers ?? []).filter((b) => b.status !== "lapsed"));
  }
  if (!canOpen) return <p className="feed-facts">{line}</p>;
  return (
    <div className="feed-backers">
      <button type="button" className="linkish feed-facts" aria-expanded={open} onClick={toggle}>{line}{"\u00a0"}{open ? "⌃" : "›"}</button>
      {open && (list === null ? <div className="skeleton" style={{ height: 40 }} /> : (
        <ul className="feed-backer-list">
          {[...list].sort((a, b) => b.amount_minor - a.amount_minor).map((b, i) => (
            <li key={i}><span>{b.name}{b.business && <span className="feed-biz">Business</span>}</span><b>{rands(b.amount_minor)}</b></li>
          ))}
        </ul>
      ))}
    </div>
  );
}

/** Real totals across all schools, shown above the national feed. Hidden until they load. */
export function FeedTotals() {
  const [real, setT] = useState<{ delivered: number; backed_minor: number; schools: number } | null>(() => readCache("feedtotals1") ?? null);
  let t = real;
  useEffect(() => {
    supabase.rpc("feed_totals").then(({ data }) => {
      const row = (Array.isArray(data) ? data[0] : data) as typeof t;
      if (row) { writeCache("feedtotals1", row); setT(row); }
    });
  }, []);
  // Trial projects count too while they show, so the strip matches the posts below it.
  const { me } = useLeague();
  const trialAll = useTrialFeed();
  const trialIds = me.is_admin ? [...new Set(trialAll.filter((i) => i.event === "delivery").map((i) => i.project_id))] : [];
  if (t && trialIds.length) t = { delivered: t.delivered + trialIds.length, schools: t.schools + trialIds.length,
    backed_minor: t.backed_minor + trialIds.reduce((n, id) => n + (TRIAL_FACTS[id]?.pledged_minor ?? 0), 0) };
  if (!t) return <div className="feed-totals" aria-hidden="true" style={{ visibility: "hidden" }}><div><b>0</b><span>x</span></div></div>;
  return (
    <div className="feed-totals">
      <div><b>{t.delivered}</b><span>{t.delivered === 1 ? "project delivered" : "projects delivered"}</span></div>
      <div><b>{rands(t.backed_minor)}</b><span>backed</span></div>
      <div><b>{t.schools}</b><span>{t.schools === 1 ? "school helped" : "schools helped"}</span></div>
    </div>
  );
}

function Comments({ it, onCount }: { it: Item; onCount: (n: number) => void }) {
  const { me, members } = useLeague();
  const [list, setList] = useState<Comment[] | null>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [emoji, setEmoji] = useState(false);
  const [reacting, setReacting] = useState<number | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const names = useMemo(() => new Map(members.map((m) => [m.user_id, m.display_name])), [members]);
  const matches = tag === null ? [] : members.filter((m) => m.user_id !== me.user_id && m.display_name.toLowerCase().startsWith(tag.toLowerCase())).slice(0, 5);

  const load = useCallback(async () => {
    let { data, error } = await supabase.rpc("feed_comments_list", { p_project: it.project_id, p_post_key: it.post_key });
    // Until the database has replies and reactions, fall back to plain comments.
    if (error) ({ data } = await supabase.rpc("feed_post_comments", { p_project: it.project_id, p_post_key: it.post_key }));
    const rows = (data ?? []) as Comment[];
    setList(rows); onCount(rows.length);
  }, [it.project_id, it.post_key, onCount]);
  useEffect(() => { load(); }, [load]);

  function onType(v: string) {
    setText(v);
    setTag(typingTag(v.slice(0, box.current?.selectionStart ?? v.length)));
  }
  function choose(m: { display_name: string }) {
    const cur = box.current?.selectionStart ?? text.length;
    const before = text.slice(0, cur).replace(/@[^@]*$/, `@${m.display_name} `);
    setText(before + text.slice(cur)); setTag(null);
    requestAnimationFrame(() => { box.current?.focus(); box.current?.setSelectionRange(before.length, before.length); });
  }
  function addEmoji(e: string) {
    const cur = box.current?.selectionStart ?? text.length;
    setText(text.slice(0, cur) + e + text.slice(cur)); setEmoji(false);
    requestAnimationFrame(() => { box.current?.focus(); box.current?.setSelectionRange(cur + e.length, cur + e.length); });
  }

  async function send() {
    const body = encodeMentions(text.trim(), members);
    if (!text.trim() || busy) return;
    setBusy(true); setErr(null);
    const { data: why } = await supabase.rpc("comment_check", { p_project: it.project_id, p_post_key: it.post_key, p_body: body });
    if (why) { setErr(why as string); setBusy(false); return; }
    const row: { project_id: number; post_key: string; body: string; reply_to?: number } = { project_id: it.project_id, post_key: it.post_key, body };
    if (replyTo) row.reply_to = replyTo.id;
    const { error } = await supabase.from("feed_comments").insert(row);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setText(""); setReplyTo(null); setTag(null); load();
  }

  // One reaction per player per comment: another swaps it, the same takes it off.
  async function react(c: Comment, e: string) {
    setReacting(null);
    const prev = c.my_reaction ?? null, on = prev === e;
    const counts = { ...(c.reactions ?? {}) };
    if (prev) counts[prev] = Math.max(0, (counts[prev] ?? 0) - 1);
    if (!on) counts[e] = (counts[e] ?? 0) + 1;
    const patch = (x: Comment) => x.id === c.id ? { ...x, reactions: counts, my_reaction: on ? null : e } : x;
    setList((cur) => (cur ?? []).map(patch));
    const t = supabase.from("feed_comment_reactions");
    let error: { message: string } | null = null;
    if (prev) ({ error } = await t.delete().match({ comment_id: c.id, user_id: me.user_id, emoji: prev }));
    if (!error && !on) ({ error } = await t.insert({ comment_id: c.id, user_id: me.user_id, emoji: e }));
    if (error && !error.message.includes("duplicate")) load();
  }

  async function report(id: number, reason: string) {
    setReporting(null);
    const { error } = await supabase.from("feed_comment_reports").insert({ comment_id: id, reason });
    if (error && !error.message.includes("duplicate")) { setErr(error.message); return; }
    setNote("Thanks. It's hidden and we'll look at it.");
    load();
  }

  const body = (b: string) => splitMentions(b).map((p, i) => "text" in p ? p.text
    : <span key={i} className={`tag${p.userId === me.user_id ? " me" : ""}`}>@{names.get(p.userId) ?? "someone"}</span>);
  const shown = list ?? [];
  const top = shown.filter((c) => !c.reply_to || !shown.some((x) => x.id === c.reply_to));
  const repliesOf = (id: number) => shown.filter((c) => c.reply_to === id);

  const row = (c: Comment, reply: boolean) => {
    const chips = EMOJI.filter((e) => (c.reactions?.[e] ?? 0) > 0);
    return (
      <div key={c.id} className={`feed-comment${reply ? " is-reply" : ""}`}>
        <div><b>{c.mine ? "You" : c.author_name ?? "Former member"}</b> <span className="small muted">{ago(c.created_at)}</span></div>
        <p>{body(c.body)}</p>
        <div className="fc-actions">
          <button type="button" className="linkish" onClick={() => { setReplyTo(c); box.current?.focus(); }}>Reply</button>
          {chips.map((e) => (
            <button key={e} type="button" className={`rchip${c.my_reaction === e ? " mine" : ""}`} aria-pressed={c.my_reaction === e} onClick={() => react(c, e)}>
              {e} <span>{c.reactions?.[e]}</span>
            </button>
          ))}
          <button type="button" className="linkish" aria-expanded={reacting === c.id} aria-label="React to this comment" onClick={() => setReacting(reacting === c.id ? null : c.id)}>☺ React</button>
          {!c.mine && (reporting === c.id
            ? <span className="small">{REASONS.map(([v, l]) => <button key={v} type="button" className="linkish" style={{ marginRight: 10 }} onClick={() => report(c.id, v)}>{l}</button>)}
                <button type="button" className="linkish muted" onClick={() => setReporting(null)}>Cancel</button></span>
            : <button type="button" className="linkish fc-report" onClick={() => setReporting(c.id)}>Report</button>)}
        </div>
        {reacting === c.id && (
          <div className="emojipick" role="group" aria-label="React">
            {EMOJI.map((e) => <button key={e} type="button" onClick={() => react(c, e)}>{e}</button>)}
          </div>
        )}
        {repliesOf(c.id).map((r) => row(r, true))}
      </div>
    );
  };

  return (
    <div className="feed-comments">
      {list === null ? <div className="skeleton" style={{ height: 48 }} /> : top.map((c) => row(c, false))}
      {note && <p className="small muted" style={{ margin: "6px 0 0" }}>{note}</p>}
      {it.trial && <p className="small muted" style={{ margin: "6px 0 0" }}><span className="trial-tag" style={{ marginRight: 8 }}>Trial</span>An example project, amounts are made up. Your comments and reactions are real and everyone can see them.</p>}
      <div className="feed-compose">
        {replyTo && (
          <p className="fc-replying small">
            <span>Replying to <b>{replyTo.mine ? "yourself" : replyTo.author_name ?? "a former member"}</b></span>
            <button type="button" className="linkish" aria-label="Cancel reply" onClick={() => setReplyTo(null)}>✕</button>
          </p>
        )}
        <div className="fc-field">
          {matches.length > 0 && (
            <ul className="tagpick" role="listbox">
              {matches.map((m) => <li key={m.user_id} role="option" aria-selected="false" onMouseDown={(e) => { e.preventDefault(); choose(m); }}>@{m.display_name}</li>)}
            </ul>
          )}
          <textarea ref={box} rows={2} maxLength={380} placeholder={replyTo ? "Write a reply" : "Say something kind. Type @ to tag a player"} value={text}
            onChange={(e) => onType(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { setTag(null); setEmoji(false); } }} />
        </div>
        {emoji && (
          <div className="emojipick fc-emoji" role="group" aria-label="Emoji">
            {COMMENT_EMOJI.map((e) => <button key={e} type="button" onClick={() => addEmoji(e)}>{e}</button>)}
          </div>
        )}
        <div className="fc-send">
          <button type="button" className="fc-emoji-btn" aria-expanded={emoji} aria-label="Add an emoji" onClick={() => setEmoji(!emoji)}>☺</button>
          <button type="button" disabled={busy || !text.trim()} onClick={send}>{busy ? "Sending…" : replyTo ? "Reply" : "Post"}</button>
        </div>
      </div>
      {err && <p className="small" style={{ color: "var(--danger)", margin: "6px 0 0" }}>{err}</p>}
    </div>
  );
}

/** The stamped heading and the one-line idea behind the feed, shared by Home and the feed page. */
export function OverTheLineHead({ intro }: { intro: string }) {
  return (
    <div className="otl-head">
      <h2 className="otl-stamp">Over the Line</h2>
      <p className="otl-intro">{intro}</p>
    </div>
  );
}

/**
 * Home: the latest from Over the Line, photo first, with one bold way
 * into the whole feed. Always shows (even before the first post) so the way in
 * never disappears.
 */
export function GoodNewsCard() {
  const [it, setIt] = useState<Item | null | undefined>(() => readCache<Item | null>("goodnews1"));
  const [url, setUrl] = useState<string | null>(null);
  const trial = useTrialFeed().find((r) => r.image_path);
  useEffect(() => {
    supabase.rpc("school_feed", { p_emis: null, p_province: null, p_before: null, p_limit: 8 }).then(({ data, error }) => {
      if (error) return;
      const rows = (data ?? []) as Item[];
      const pick = rows.find((r) => r.image_path) ?? rows[0] ?? null;
      writeCache("goodnews1", pick); setIt(pick);
    });
  }, []);
  const latest = trial && (!it?.image_path || trial.at > it.at) ? trial : it;
  useEffect(() => { setUrl(null); if (latest?.image_path) photoUrl(latest.image_path).then(setUrl); }, [latest?.image_path]);
  const where = latest ? [latest.town, provinceName(latest.province)].filter(Boolean).join(", ") : "";
  return (
    <div className="card goodnews">
      <OverTheLineHead intro="Schools set the goal. Every call you make helps carry a project over the line." />
      {latest && (
        <Link href="/feed/" className="gn-latest">
          {latest.image_path && (
            <div className="feed-hero">
              {url ? <img src={url} alt={latest.note ?? latest.title} /> : <div className="skeleton feed-hero-skel" />}
              <span className="feed-stamp">{STAMP[latest.event] ?? "Update"}</span>
              <div className="feed-hero-foot"><b>{latest.school}</b><span>{where}</span></div>
            </div>
          )}
          {!latest.image_path && (
            <div className="gn-text"><span className="feed-stamp flat">{STAMP[latest.event] ?? "Update"}</span><b>{latest.school}</b><span className="small muted">{where}</span></div>
          )}
          <p className="feed-title" style={{ margin: "10px 0 0" }}><b>{latest.title}</b>{"trial" in latest && <span className="trial-tag">Trial</span>}</p>
        </Link>
      )}
      {latest === null && <p className="sub" style={{ margin: "0 0 4px" }}>Projects are coming to schools. Every one shows up here, with photos.</p>}
      <Link href="/feed/" className="btn gn-go">See all ›</Link>
    </div>
  );
}
