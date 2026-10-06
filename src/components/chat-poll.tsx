"use client";

import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import type { Member } from "@/lib/types";

export interface PollVote { message_id: number; user_id: string; choice: number }

/**
 * A poll inside its chat bubble: the question, then each answer as a row you
 * tap to vote, filling with its share of the votes. Your answer is ticked,
 * and you can change it. "See votes" lists who picked what.
 */
export function PollCard({ question, options, votes, me, people, onVote }: {
  question: string; options: string[]; votes: PollVote[]; me: string;
  people: Map<string, Member>; onVote: (choice: number) => void;
}) {
  const [who, setWho] = useState(false);
  const mine = votes.find((v) => v.user_id === me)?.choice;
  const total = votes.length;
  const count = (i: number) => votes.filter((v) => v.choice === i).length;
  const top = Math.max(0, ...options.map((_, i) => count(i)));
  const name = (id: string) => (id === me ? "You" : people.get(id)?.display_name ?? "Former member");
  return (
    <div className="poll" onClick={(e) => e.stopPropagation()}>
      <p className="poll-q">{question}</p>
      <p className="poll-hint small">{mine === undefined ? "Pick one" : "Tap another answer to change your vote"}</p>
      <div className="poll-opts" role="radiogroup" aria-label={question}>
        {options.map((o, i) => {
          const n = count(i);
          const share = total ? Math.round((n / total) * 100) : 0;
          const on = mine === i;
          return (
            <button key={i} type="button" role="radio" aria-checked={on} className={`poll-opt${on ? " on" : ""}${n > 0 && n === top ? " lead" : ""}`}
              onClick={() => { if (!on) onVote(i); }}>
              <span className="poll-fill" style={{ width: `${share}%` }} aria-hidden="true" />
              <span className="poll-mark" aria-hidden="true">{on ? "✓" : ""}</span>
              <span className="poll-text">{o}</span>
              <span className="poll-n" aria-label={`${n} ${n === 1 ? "vote" : "votes"}, ${share}%`}>{share}%</span>
            </button>
          );
        })}
      </div>
      <div className="poll-foot small">
        <span>{total === 0 ? "No votes yet" : `${total} ${total === 1 ? "vote" : "votes"}`}</span>
        {total > 0 && <button type="button" className="linkish small" onClick={() => setWho(!who)}>{who ? "Hide votes" : "See votes"}</button>}
      </div>
      {who && (
        <ul className="poll-who small">
          {options.map((o, i) => {
            const ids = votes.filter((v) => v.choice === i).map((v) => v.user_id).sort((a, b) => (a === me ? -1 : b === me ? 1 : 0));
            return ids.length ? <li key={i}><strong>{o}</strong> <span className="poll-who-n">{ids.length}</span> {ids.map(name).join(", ")}</li> : null;
          })}
        </ul>
      )}
    </div>
  );
}

const MAX = 6;

/** Ask the league something: a question and 2 to 6 answers, sent as one message. */
export function PollComposer({ pool, onClose, onSent }: { pool: number; onClose: () => void; onSent: () => void }) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const filled = options.map((o) => o.trim()).filter(Boolean);
  const ready = question.trim().length > 0 && filled.length >= 2;

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    const lower = filled.map((o) => o.toLowerCase());
    if (new Set(lower).size !== lower.length) { setMsg("Each answer must be different."); return; }
    setBusy(true); setMsg(null);
    // The same word check as any message, before it goes.
    const { data: refusal } = await supabase.rpc("chat_check", { p_pool: pool, p_body: [question, ...filled].join("\n") });
    if (refusal) { setBusy(false); setMsg(refusal as string); return; }
    const { error } = await supabase.rpc("post_poll", { p_pool: pool, p_question: question.trim(), p_options: filled });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    onSent();
  }

  return (
    <div className="wip-dim" onClick={onClose}>
      <form className="wip-sheet poll-new" role="dialog" aria-modal="true" aria-labelledby="poll-title" onClick={(e) => e.stopPropagation()} onSubmit={send}>
        <div className="tsheet-head">
          <h2 id="poll-title">New poll</h2>
          <button type="button" className="ghost tsheet-done" onClick={onClose}>Cancel</button>
        </div>
        <label>Question
          <input autoFocus maxLength={140} placeholder="e.g. Who wins the derby on Saturday?" value={question} onChange={(e) => setQuestion(e.target.value)} />
        </label>
        <p className="poll-label">Answers</p>
        {options.map((o, i) => (
          <div key={i} className="poll-new-row">
            <input maxLength={60} placeholder={`Answer ${i + 1}`} aria-label={`Answer ${i + 1}`} value={o}
              onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} />
            {options.length > 2 && (
              <button type="button" className="ghost poll-new-x" aria-label={`Remove answer ${i + 1}`}
                onClick={() => setOptions(options.filter((_, j) => j !== i))}>×</button>
            )}
          </div>
        ))}
        {options.length < MAX && (
          <button type="button" className="linkish poll-add" onClick={() => setOptions([...options, ""])}>+ Add an answer</button>
        )}
        <p className="small muted poll-note">Everyone in the league can vote once and change their vote. Votes show who picked what.</p>
        {msg && <p className="small" style={{ color: "var(--danger)" }}>{msg}</p>}
        <button type="submit" className="poll-send" disabled={!ready || busy}>{busy ? "Sending…" : "Send poll"}</button>
      </form>
    </div>
  );
}
