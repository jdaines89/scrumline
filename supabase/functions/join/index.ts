// Turns a player's invite link into a real Supabase invite (see migration
// 20260927000300_invite_links.sql). Public sign-up is off; this is the only
// door, and every account it opens is recorded against the link's owner.
// The database decides whether the link may invite this email
// (invite_check: valid link, new email, at most 20 who have not played yet per link, 10 an hour).
// With a league code (pool), the newcomer is put straight into that league if the inviter plays in it.
// Nobody leaves the app to sign in: instead of Supabase's invite email (a link,
// then a password), Supabase makes a one-time code without emailing it, and
// public.send_login_code emails just the code. The app verifies it in
// place. mode "signin" sends a code to someone who already has an account.
// Deployed with verify_jwt off: people using it have no account yet.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);
  let code = "", email = "", pool = "", mode = "";
  try { ({ code, email, pool, mode } = await req.json()); } catch { return reply({ error: "Bad request" }, 400); }
  email = String(email ?? "").trim().toLowerCase();
  code = String(code ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply({ error: "That doesn't look like an email address." }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Signing in on a new phone: same answer whether or not the email has an
  // account, so the form can't be used to find out who plays.
  if (mode === "signin") {
    const { data: known } = await db.rpc("login_email_known", { p_email: email });
    if (known) {
      const sent = await sendCode(db, email, "signin");
      if (sent === "limited") return reply({ error: "Too many codes for that email. Try again in an hour." }, 429);
    }
    return reply({ status: "code" });
  }

  const { data: check, error } = await db.rpc("invite_check", { p_code: code, p_email: email }).single<{ inviter: string | null; problem: string | null }>();
  if (error) return reply({ error: "Something went wrong. Try again in a minute." }, 500);
  // Already has an account (or a half-finished invite): sign them in with a code instead.
  if (check?.problem === "exists") {
    const sent = await sendCode(db, email, "join");
    if (sent === "limited") return reply({ error: "Too many codes for that email. Try again in an hour." }, 429);
    if (sent !== "sent") return reply({ status: "exists" });
    return reply({ status: "code", existing: true });
  }
  if (!check?.inviter) return reply({ error: check?.problem ?? "That invite link isn't valid." }, 400);

  // Creates the invited account (the members trigger runs as for any invite) without sending Supabase's email.
  const { data: link, error: linkErr } = await db.auth.admin.generateLink({ type: "invite", email });
  const otp = link?.properties?.email_otp;
  if (linkErr || !link?.user || !otp) {
    console.error("invite failed", linkErr?.message);
    return reply({ error: "We couldn't start your sign-up. Try again in a minute." }, 500);
  }
  const { error: recErr } = await db.rpc("invite_record", { p_invitee: link.user.id, p_inviter: check.inviter, p_email: email });
  if (recErr) console.error("invite not recorded", recErr.message);
  const league = String(pool ?? "").trim();
  if (league && !recErr) {
    const { error: poolErr } = await db.rpc("invite_join_pool", { p_invitee: link.user.id, p_inviter: check.inviter, p_pool: league });
    if (poolErr) console.error("league not joined", poolErr.message);
  }
  const { data: sent, error: sendErr } = await db.rpc("send_login_code", { p_email: email, p_code: otp, p_purpose: "join" });
  if (sent !== "sent") {
    console.error("code not emailed", sent, sendErr?.message);
    return reply({ error: "We couldn't email your code. Try again in a minute." }, 500);
  }
  return reply({ status: "code", type: "invite" });
});

/** A sign-in code for an existing account. A half-finished invite gets a fresh invite code. */
async function sendCode(db: SupabaseClient, email: string, purpose: "join" | "signin"): Promise<string> {
  let { data: link, error } = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !link?.properties?.email_otp) ({ data: link, error } = await db.auth.admin.generateLink({ type: "invite", email }));
  const otp = link?.properties?.email_otp;
  if (error || !otp) { console.error("code failed", error?.message); return "failed"; }
  const { data, error: sendErr } = await db.rpc("send_login_code", { p_email: email, p_code: otp, p_purpose: purpose });
  if (sendErr) console.error("code not emailed", sendErr.message);
  return String(data ?? "failed");
}

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });
}
