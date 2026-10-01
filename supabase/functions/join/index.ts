// Turns a player's invite link into a real Supabase invite (see migration
// 20260927000300_invite_links.sql). Public sign-up is off; this is the only
// door, and every account it opens is recorded against the link's owner.
// The database decides whether the link may invite this email
// (invite_check: valid link, new email, at most 20 who have not played yet per link, 10 an hour).
// Deployed with verify_jwt off: people using it have no account yet.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);
  let code = "", email = "";
  try { ({ code, email } = await req.json()); } catch { return reply({ error: "Bad request" }, 400); }
  email = String(email ?? "").trim().toLowerCase();
  code = String(code ?? "").trim().toLowerCase();

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: check, error } = await db.rpc("invite_check", { p_code: code, p_email: email }).single<{ inviter: string | null; problem: string | null }>();
  if (error) return reply({ error: "Something went wrong. Try again in a minute." }, 500);
  if (check?.problem === "exists") return reply({ status: "exists" });
  if (!check?.inviter) return reply({ error: check?.problem ?? "That invite link isn't valid." }, 400);

  const { data: invited, error: invErr } = await db.auth.admin.inviteUserByEmail(email);
  if (invErr || !invited?.user) {
    // Already invited but never finished signing up: tell them to find the email.
    if (/already/i.test(invErr?.message ?? "")) return reply({ status: "exists" });
    console.error("invite failed", invErr?.message);
    return reply({ error: "We couldn't send the invite. Try again in a minute." }, 500);
  }
  const { error: recErr } = await db.rpc("invite_record", { p_invitee: invited.user.id, p_inviter: check.inviter, p_email: email });
  if (recErr) console.error("invite not recorded", recErr.message);
  return reply({ status: "sent" });
});

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });
}
