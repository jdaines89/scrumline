"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useLeague } from "@/components/league";
import { readCache, writeCache } from "@/lib/cache";
import { provinceName, schoolHref } from "@/lib/crest";
import { projectPhotoUrl } from "@/lib/projects";
import { supabase } from "@/lib/supabase";

const EMOJI = ["👍", "🔥", "🏉", "😮", "😢", "😂"];
const PAGE = 20;
const REASONS: [string, string][] = [["hate", "Hateful"], ["bullying", "Bullying"], ["sexual", "Sexual"], ["other", "Something else"]];

interface Item {
  project_id: number; post_key: string; at: string; event: string; emis: string; school: string; town: string | null;
  province: string; title: string; note: string | null; image_path: string | null;
  reactions: Record<string, number>; mine: string[]; comments: number;
}
interface Facts { project_id: number; items: string; target_minor: number; pledged_minor: number; backers: number; learners: number | null }
interface Comment { id: number; author_id: string; author_name: string | null; body: string; created_at: string; mine: boolean }

/** "5 min ago", "3 h ago", "2 d ago", else the date. */
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

/**
 * The good happening at schools: project events, newest first. One school's, one
 * province's, or the whole country's. Every post is a project event, so nothing
 * floats loose, and reactions and comments follow the chat rules.
 */
export function SchoolFeed({ emis, province, empty }: { emis?: string; province?: string; empty?: string }) {
  const { me } = useLeague();
  const key = `feed1:${emis ?? ""}:${province ?? ""}`;
  const [items, setItems] = useState<Item[] | null>(() => readCache<Item[]>(key) ?? null);
  const [more, setMore] = useState(true);
  const [busy, setBusy] = useState(false);
  const [facts, setFacts] = useState<Record<number, Facts>>({});

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

  if (!items) return <div className="skeleton" style={{ height: 200 }} />;
  if (!items.length) return <p className="sub" style={{ margin: 0 }}>{empty ?? "Nothing yet. When a project opens or arrives at a school, it shows up here."}</p>;
  return (
    <div className="feed">
      {items.map((it) => <FeedCard key={`${it.project_id}:${it.post_key}`} it={it} me={me.user_id} showSchool={!emis} facts={facts[it.project_id]} />)}
      {more && (
        <button type="button" className="ghost feed-more" disabled={busy}
          onClick={async () => { setBusy(true); await load(items[items.length - 1].at); setBusy(false); }}>
          {busy ? "Loading…" : "Show more"}
        </button>
      )}
    </div>
  );
}

function FeedCard({ it, me, showSchool, facts }: { it: Item; me: string; showSchool: boolean; facts?: Facts }) {
  const [mine, setMine] = useState<string[]>(it.mine);
  const [counts, setCounts] = useState<Record<string, number>>(it.reactions);
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [total, setTotal] = useState(it.comments);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { if (it.image_path) projectPhotoUrl(it.image_path).then(setUrl); }, [it.image_path]);

  async function react(e: string) {
    const on = mine.includes(e);
    setMine(on ? mine.filter((x) => x !== e) : [...mine, e]);
    setCounts({ ...counts, [e]: Math.max(0, (counts[e] ?? 0) + (on ? -1 : 1)) });
    const { error } = on
      ? await supabase.from("feed_reactions").delete().match({ project_id: it.project_id, post_key: it.post_key, user_id: me, emoji: e })
      : await supabase.from("feed_reactions").insert({ project_id: it.project_id, post_key: it.post_key, user_id: me, emoji: e });
    if (error && !error.message.includes("duplicate")) { setMine(it.mine); setCounts(it.reactions); }
  }

  const stamp = STAMP[it.event] ?? "Update";
  const where = [it.town, provinceName(it.province)].filter(Boolean).join(", ");
  const facts_line = facts
    ? [facts.backers > 0 ? `${rands(facts.pledged_minor)} from ${facts.backers} ${facts.backers === 1 ? "backer" : "backers"}` : null,
       facts.learners ? `${aboutLearners(facts.learners)} learners` : null].filter(Boolean).join(" · ")
    : "";
  const others = EMOJI.filter((e) => e !== "🔥");

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
        <p className="feed-when small muted">{ago(it.at)}</p>
        <p className="feed-title"><b>{it.title}</b></p>
        {it.note && <p className="feed-note">{it.note}</p>}
        {facts?.items && <p className="feed-facts">{facts.items}{facts_line && <span> · {facts_line}</span>}</p>}
        <div className="feed-actions">
          <button type="button" className={`cheer${mine.includes("🔥") ? " mine" : ""}`} aria-pressed={mine.includes("🔥")} onClick={() => react("🔥")}>
            🔥 Cheer{(counts["🔥"] ?? 0) > 0 && <span>{counts["🔥"]}</span>}
          </button>
          <button type="button" className="rchip" aria-expanded={open} onClick={() => setOpen(!open)}>
            {total > 0 ? `${total} comment${total === 1 ? "" : "s"}` : "Comment"}
          </button>
          <button type="button" className="rchip" aria-expanded={more} aria-label="More reactions" onClick={() => setMore(!more)}>{more ? "Less" : "More"}</button>
        </div>
        {(more || others.some((e) => (counts[e] ?? 0) > 0)) && (
          <div className="reactions feed-react">
            {others.filter((e) => more || (counts[e] ?? 0) > 0).map((e) => (
              <button key={e} type="button" className={`rchip${mine.includes(e) ? " mine" : ""}`} aria-pressed={mine.includes(e)} onClick={() => react(e)}>
                {e}{(counts[e] ?? 0) > 0 && <> <span>{counts[e]}</span></>}
              </button>
            ))}
          </div>
        )}
        {open && <Comments it={it} onCount={setTotal} />}
      </div>
    </article>
  );
}

/** Real totals across all schools, shown above the national feed. Hidden until they load. */
export function FeedTotals() {
  const [t, setT] = useState<{ delivered: number; backed_minor: number; schools: number } | null>(() => readCache("feedtotals1") ?? null);
  useEffect(() => {
    supabase.rpc("feed_totals").then(({ data }) => {
      const row = (Array.isArray(data) ? data[0] : data) as typeof t;
      if (row) { writeCache("feedtotals1", row); setT(row); }
    });
  }, []);
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
  const [list, setList] = useState<Comment[] | null>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("feed_post_comments", { p_project: it.project_id, p_post_key: it.post_key });
    const rows = (data ?? []) as Comment[];
    setList(rows); onCount(rows.length);
  }, [it.project_id, it.post_key, onCount]);
  useEffect(() => { load(); }, [load]);

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true); setErr(null);
    const { data: why } = await supabase.rpc("comment_check", { p_project: it.project_id, p_post_key: it.post_key, p_body: body });
    if (why) { setErr(why as string); setBusy(false); return; }
    const { error } = await supabase.from("feed_comments").insert({ project_id: it.project_id, post_key: it.post_key, body });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setText(""); load();
  }

  async function report(id: number, reason: string) {
    setReporting(null);
    const { error } = await supabase.from("feed_comment_reports").insert({ comment_id: id, reason });
    if (error && !error.message.includes("duplicate")) { setErr(error.message); return; }
    setNote("Thanks. It's hidden and we'll look at it.");
    load();
  }

  return (
    <div className="feed-comments">
      {list === null ? <div className="skeleton" style={{ height: 48 }} /> : list.map((c) => (
        <div key={c.id} className="feed-comment">
          <div><b>{c.mine ? "You" : c.author_name ?? "Former member"}</b> <span className="small muted">{ago(c.created_at)}</span></div>
          <p>{c.body}</p>
          {!c.mine && (reporting === c.id
            ? <div className="small">{REASONS.map(([v, l]) => <button key={v} type="button" className="linkish" style={{ marginRight: 10 }} onClick={() => report(c.id, v)}>{l}</button>)}
                <button type="button" className="linkish muted" onClick={() => setReporting(null)}>Cancel</button></div>
            : <button type="button" className="linkish small" style={{ color: "var(--muted)" }} onClick={() => setReporting(c.id)}>Report</button>)}
        </div>
      ))}
      {note && <p className="small muted" style={{ margin: "6px 0 0" }}>{note}</p>}
      <div className="feed-compose">
        <textarea rows={2} maxLength={500} placeholder="Say something kind" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="button" disabled={busy || !text.trim()} onClick={send}>{busy ? "Sending…" : "Post"}</button>
      </div>
      {err && <p className="small" style={{ color: "var(--danger)", margin: "6px 0 0" }}>{err}</p>}
    </div>
  );
}
