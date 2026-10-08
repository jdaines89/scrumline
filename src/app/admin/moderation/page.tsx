"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useLeague } from "@/components/league";
import { photoUrl } from "@/lib/photo";
import { supabase } from "@/lib/supabase";

interface Held {
  message_id: number; pool_name: string; school: boolean; author_id: string; author_name: string | null;
  body: string; image_path: string | null; held_at: string; posted_at: string;
  reports: number; reasons: string | null; author_removed: number; author_caught: number;
}
interface Caught { id: number; author_name: string | null; place: string; pool_name: string | null; body: string; category: string; created_at: string }
interface Ban { user_id: string; name: string; until: string; reason: string }
interface Problem { id: number; name: string | null; email: string | null; body: string; page: string | null; error: string | null; device: string | null; created_at: string; done_at: string | null }
interface Term { term: string; category: string; whole: boolean }

const REASON: Record<string, string> = { hate: "racism or hate", bullying: "bullying", sexual: "sexual", other: "something else" };
const CATEGORY: Record<string, string> = { hate: "Racist or hateful", threat: "Threat", sexual: "Sexual", swearing: "Swearing", spam: "Spam" };

/** The little that needs a person: messages people reported, chat bans, and the word list. */
export default function AdminModeration() {
  const { me } = useLeague();
  const [held, setHeld] = useState<Held[] | null>(null);
  const [caught, setCaught] = useState<Caught[] | null>(null);
  const [bans, setBans] = useState<Ban[] | null>(null);
  const [problems, setProblems] = useState<Problem[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const [h, c, b] = await Promise.all([supabase.rpc("mod_queue"), supabase.rpc("mod_caught", { p_limit: 50 }), supabase.rpc("mod_bans")]);
    supabase.rpc("mod_problems", { p_limit: 50 }).then(({ data }) => setProblems((data ?? []) as Problem[]));
    setHeld((h.data ?? []) as Held[]);
    setCaught((c.data ?? []) as Caught[]);
    setBans((b.data ?? []) as Ban[]);
  }, []);
  useEffect(() => { if (me.is_admin) load(); }, [me.is_admin, load]);

  if (!me.is_admin) return <div className="card narrow"><h2>Admins only</h2></div>;

  async function decide(h: Held, action: "keep" | "remove" | "ban") {
    const { data, error } = await supabase.rpc("mod_decide", { p_message: h.message_id, p_action: action });
    if (!error && action !== "keep" && h.image_path) await supabase.storage.from("chat-photos").remove([h.image_path]);
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: `${data as string}.` });
    load();
  }

  async function run(p: PromiseLike<{ error: { message: string } | null }>, done: string) {
    const { error } = await p;
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: done });
    load();
  }

  return (
    <>
      <div className="card narrow">
        <p className="sp-kicker">Admin</p>
        <h2>Reported messages</h2>
        <p className="sub">Hidden from everyone until you decide. Keep puts it back. Remove deletes it, and a second removal in 30 days means a week without chat. Remove and ban keeps them out of chat until you lift it.</p>
        {msg && <p className="small" style={{ color: msg.ok ? "var(--accent)" : "var(--danger)" }}>{msg.text}</p>}
        {held === null && <div className="skeleton" style={{ height: 80 }} />}
        {held?.length === 0 && <p className="small muted" style={{ marginBottom: 0 }}>Nothing to look at.</p>}
        {held?.map((h) => (
          <div key={h.message_id} className="task">
            <strong>{h.author_name ?? "Former member"}</strong>
            <span className="small muted">{h.pool_name} · {when(h.posted_at)}</span>
            {h.image_path && <HeldPhoto path={h.image_path} />}
            {h.body.trim() && <blockquote className="modquote">{h.body.replace(/<@[0-9a-f-]{36}>/g, "@someone")}</blockquote>}
            <div className="small muted">
              Reported {h.reports} time{h.reports === 1 ? "" : "s"}{h.reasons ? ` for ${h.reasons.split(", ").map((r) => REASON[r] ?? r).join(", ")}` : ""}
              {h.school ? " · school league" : ""}
              {h.author_removed + h.author_caught > 0 ? ` · in 30 days: ${h.author_removed} removed, ${h.author_caught} stopped by the filter` : ""}
            </div>
            <div className="modacts">
              <button type="button" className="ghost" onClick={() => decide(h, "keep")}>Keep</button>
              <button type="button" className="danger" onClick={() => decide(h, "remove")}>Remove</button>
              <button type="button" className="danger" onClick={() => decide(h, "ban")}>Remove and ban</button>
              <button type="button" className="linkish small" onClick={() => run(supabase.rpc("mod_clear_avatar", { p_user: h.author_id }), "Profile picture cleared.")}>Clear their profile picture</button>
            </div>
          </div>
        ))}
      </div>

      <div className="card narrow">
        <h2>Problems players reported</h2>
        <p className="sub">From Report a problem. Each one is also emailed to you; reply there to answer the player.</p>
        {problems === null && <div className="skeleton" style={{ height: 60 }} />}
        {problems?.length === 0 && <p className="small muted" style={{ marginBottom: 0 }}>No problems reported.</p>}
        {problems?.map((p, i) => (
          <div key={p.id} className={`rowline${i === 0 ? " first" : ""}`} style={p.done_at ? { opacity: 0.55 } : undefined}>
            <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{p.body}
              {p.error && <small className="muted block">Error: {p.error}</small>}
              <small className="muted block">{p.name ?? "Not signed in"}{p.email ? ` · ${p.email}` : ""} · {p.page ?? ""} · {when(p.created_at)}</small>
              {p.device && <small className="muted block">{p.device}</small>}
            </span>
            {!p.done_at && <button type="button" className="ghost" onClick={() => run(supabase.rpc("mod_problem_done", { p_id: p.id }), "Marked as sorted.")}>Sorted</button>}
          </div>
        ))}
      </div>

      <div className="card narrow">
        <h2>Chat bans</h2>
        <p className="sub">Three messages stopped for hate or threats, or three for spam, in a day mean a day off chat; a second ban within 30 days is a week.</p>
        {bans?.length === 0 && <p className="small muted" style={{ marginBottom: 0 }}>Nobody is banned.</p>}
        {bans?.map((b, i) => (
          <div key={b.user_id} className={`rowline${i === 0 ? " first" : ""}`}>
            <span>{b.name}<small className="muted block">{b.reason} · {new Date(b.until).getFullYear() > 9000 ? "until you lift it" : `until ${when(b.until)}`}</small></span>
            <button type="button" className="ghost" onClick={() => run(supabase.rpc("mod_lift", { p_user: b.user_id }), `${b.name} can chat again.`)}>Lift</button>
          </div>
        ))}
      </div>

      <div className="card narrow">
        <h2>Stopped by the filter</h2>
        <p className="sub">Messages that never reached anyone. Nothing to do here unless the filter got one wrong.</p>
        {caught?.length === 0 && <p className="small muted" style={{ marginBottom: 0 }}>Nothing stopped yet.</p>}
        {!!caught?.length && (
          <details>
            <summary className="small">Show the last {caught.length}</summary>
            {caught.map((c, i) => (
              <div key={c.id} className={`rowline${i === 0 ? " first" : ""}`}>
                <span>{c.body}<small className="muted block">{c.author_name ?? "Former member"} · {c.pool_name ?? c.place} · {when(c.created_at)}</small></span>
                <span className="small muted">{CATEGORY[c.category] ?? c.category}</span>
              </div>
            ))}
          </details>
        )}
      </div>

      <Words onMessage={setMsg} />
    </>
  );
}

function Words({ onMessage }: { onMessage: (m: { ok: boolean; text: string }) => void }) {
  const [terms, setTerms] = useState<Term[] | null>(null);
  const [word, setWord] = useState("");
  const [category, setCategory] = useState("hate");
  const [whole, setWhole] = useState(true);
  const [trial, setTrial] = useState("");
  const [verdict, setVerdict] = useState<string | null | undefined>(undefined);

  const load = useCallback(() => {
    supabase.rpc("mod_terms").then(({ data }) => setTerms((data ?? []) as Term[]));
  }, []);
  useEffect(load, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc("mod_add_term", { p_term: word, p_category: category, p_whole: whole });
    onMessage(error ? { ok: false, text: error.message } : { ok: true, text: "Added to the word list." });
    if (!error) setWord("");
    load();
  }

  async function remove(t: string) {
    const { error } = await supabase.rpc("mod_remove_term", { p_term: t });
    onMessage(error ? { ok: false, text: error.message } : { ok: true, text: "Taken off the word list." });
    load();
  }

  async function tryIt(e: FormEvent) {
    e.preventDefault();
    const { data } = await supabase.rpc("mod_try", { p_text: trial });
    setVerdict((data as string | null) ?? null);
  }

  return (
    <div className="card narrow">
      <h2>Word list</h2>
      <p className="sub">Racist and hateful words and threats are stopped everywhere. Sexual words and swearing are stopped in names and in school and class leagues. The filter sees through capitals, accents, numbers for letters, spaced-out letters and * for a vowel.</p>
      <form onSubmit={tryIt} className="row">
        <input placeholder="Try a message" value={trial} onChange={(e) => { setTrial(e.target.value); setVerdict(undefined); }} />
        <button type="submit" className="ghost" disabled={!trial.trim()}>Check</button>
      </form>
      {verdict !== undefined && <p className="small" style={{ color: verdict ? "var(--danger)" : "var(--accent)" }}>{verdict ? `Stopped: ${CATEGORY[verdict]}` : "Gets through."}</p>}
      <form onSubmit={add} className="row" style={{ marginTop: 10 }}>
        <input placeholder="Add a word or phrase" value={word} onChange={(e) => setWord(e.target.value)} />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="small muted" style={{ whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={!whole} onChange={(e) => setWhole(!e.target.checked)} /> and longer words
        </label>
        <button type="submit" disabled={word.trim().length < 2}>Add</button>
      </form>
      {terms && (
        <details style={{ marginTop: 10 }}>
          <summary className="small">Show all {terms.length} words</summary>
          {terms.map((t, i) => (
            <div key={t.term} className={`rowline${i === 0 ? " first" : ""}`}>
              <span>{t.term}<small className="muted block">{CATEGORY[t.category]}{t.whole ? "" : " · and longer words"}</small></span>
              <button type="button" className="ghost" onClick={() => remove(t.term)}>Remove</button>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

/** A held chat photo, which only admins can still open. */
function HeldPhoto({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { photoUrl(path).then(setUrl); }, [path]);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img className="modphoto" src={url} alt="Reported photo" /> : <div className="modphoto skeleton" />;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}
