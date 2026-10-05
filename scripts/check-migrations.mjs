#!/usr/bin/env node
// Guards the live database, which holds real players' calls and chat.
//
// Every migration added on this branch (compared with the base branch) must:
//   1. be new: a migration already on main has been applied live, so editing
//      it changes nothing there and only makes the repo lie;
//   2. sort after every migration already on main, so it applies last;
//   3. be additive: no DROP, TRUNCATE, DELETE FROM or ALTER ... DROP outside a
//      function body. Those lose data, and Supabase also holds them for a
//      confirmation that never reaches us, so they can't be applied anyway.
//      Use CREATE OR REPLACE (functions, views, triggers), ALTER POLICY,
//      ADD COLUMN IF NOT EXISTS, or leave the old object unused.
//
// A file that truly needs one can carry "-- destructive-ok: <reason>" and is
// then reported but not failed; it still needs the owner's explicit go.
//
// Usage: node scripts/check-migrations.mjs [base-ref]   (default origin/main)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const DIR = "supabase/migrations/";
const base = process.argv[2] || "origin/main";
const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();

const mergeBase = git("merge-base", base, "HEAD");
const changed = git("diff", "--name-status", mergeBase, "HEAD", "--", DIR)
  .split("\n").filter(Boolean).map((l) => l.split("\t"));
const onBase = git("ls-tree", "--name-only", mergeBase, DIR).split("\n").filter(Boolean).map((p) => p.slice(DIR.length));
const latestOnBase = onBase.sort().at(-1) ?? "";

/** The SQL with comments, string literals and dollar-quoted bodies blanked out. */
export function topLevel(sql) {
  let out = "";
  for (let i = 0; i < sql.length; ) {
    const rest = sql.slice(i);
    let m;
    if (rest.startsWith("--")) { const e = sql.indexOf("\n", i); i = e < 0 ? sql.length : e; continue; }
    if (rest.startsWith("/*")) { const e = sql.indexOf("*/", i + 2); i = e < 0 ? sql.length : e + 2; continue; }
    if (sql[i] === "'") { const e = sql.indexOf("'", i + 1); i = e < 0 ? sql.length : e + 1; out += "''"; continue; }
    if ((m = /^\$[A-Za-z_]*\$/.exec(rest))) {
      const e = sql.indexOf(m[0], i + m[0].length);
      i = e < 0 ? sql.length : e + m[0].length; out += " $body$ "; continue;
    }
    out += sql[i++];
  }
  return out;
}

const RULES = [
  [/\bdrop\s+(table|schema|view|materialized\s+view|function|procedure|trigger|policy|index|type|sequence|extension|column|constraint)\b/i, "DROP"],
  [/\btruncate\b/i, "TRUNCATE"],
  [/\bdelete\s+from\b/i, "DELETE FROM"],
];

const problems = [];
const notes = [];
for (const [status, file, renamed] of changed) {
  const path = renamed ?? file;
  const name = path.slice(DIR.length);
  if (status === "D") { problems.push(`${name}: deleted. Applied migrations stay in the repo.`); continue; }
  if (status !== "A") { problems.push(`${name}: changed after it was merged. Add a new migration instead.`); continue; }
  if (name <= latestOnBase) problems.push(`${name}: sorts before ${latestOnBase} on main. Give it a later timestamp.`);
  const sql = readFileSync(path, "utf8");
  const ok = /--\s*destructive-ok:\s*\S/.test(sql);
  const top = topLevel(sql);
  for (const [re, what] of RULES) {
    const hit = top.match(new RegExp(re.source, "gi"));
    if (!hit) continue;
    const msg = `${name}: ${what} at the top level (${hit.length}x).`;
    (ok ? notes : problems).push(ok ? `${msg} Marked destructive-ok, so it needs the owner's explicit go.` : msg);
  }
}

for (const n of notes) console.log(`note: ${n}`);
if (problems.length) {
  for (const p of problems) console.error(`fail: ${p}`);
  console.error("\nUse CREATE OR REPLACE, ALTER POLICY or ADD COLUMN IF NOT EXISTS; see the top of scripts/check-migrations.mjs.");
  process.exit(1);
}
console.log(`migrations ok (${changed.length} changed, latest on base ${latestOnBase || "none"})`);
