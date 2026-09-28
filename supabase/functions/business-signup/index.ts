// A business signs itself up to sponsor a school, or a school's contact
// signs up to claim it (kind = 'school').
//
// Public sign-up stays off; this function makes the account as service role,
// marked kind = 'business' or 'school', so the database turns it into that
// kind of account (never a member). An address that already plays gets the
// school side added to its account instead. The link goes out in our own email through Brevo. The
// reply is the same whether or not the address already has an account, so
// the form can't be used to find out who plays.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SENT = { ok: true, message: "Check your email for a link to carry on." };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const school = body.kind === "school";
  const name = (typeof (school ? body.contact : body.business) === "string" ? (school ? body.contact : body.business) : "").trim().replace(/\s+/g, " ");
  const role = ["principal", "bursar", "sgb", "alumni"].includes(body.role) ? body.role : "sgb";
  if (!EMAIL.test(email) || email.length > 200) return json({ error: "Check the email address." }, 400);
  if (name.length < 2 || name.length > 60) return json({ error: school ? "Give your name (2 to 60 characters)." : "Give the business name (2 to 60 characters)." }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // At most 3 links per address a day and 10 per connection an hour.
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const day = new Date(Date.now() - 864e5).toISOString(), hour = new Date(Date.now() - 36e5).toISOString();
  const [byEmail, byIp] = await Promise.all([
    db.from("business_signups").select("id", { count: "exact", head: true }).eq("email", email).gte("at", day),
    ip ? db.from("business_signups").select("id", { count: "exact", head: true }).eq("ip", ip).gte("at", hour)
       : Promise.resolve({ count: 0 }),
  ]);
  if ((byEmail.count ?? 0) >= 3 || (byIp.count ?? 0) >= 10) return json({ error: "Too many tries. Try again later." }, 429);
  await db.from("business_signups").insert({ email, ip });

  const site = Deno.env.get("SITE_URL") ?? "https://jdaines89.github.io/scrumline";
  const redirectTo = school ? `${site}/school/` : `${site}/sponsor/`;
  const data = school ? { kind: "school", contact_name: name, role } : { kind: "business", business_name: name };

  let existing = false;
  let link = await db.auth.admin.generateLink({
    type: "invite", email, options: { redirectTo, data },
  });
  if (link.error && /already|registered|exists/i.test(link.error.message)) {
    existing = true;
    link = await db.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo } });
  }
  const url = link.data?.properties?.action_link;
  if (link.error || !url) return json({ error: "Couldn't start the sign-up. Try again in a minute." }, 502);

  if (existing && school && link.data?.user?.id) {
    await db.rpc("add_school_account", { p_user: link.data.user.id, p_contact: name, p_role: role });
  }
  const sent = await db.rpc(school ? "send_school_link" : "send_business_link", { p_email: email, p_name: name, p_link: url, p_existing: existing });
  if (sent.error) return json({ error: "Couldn't send the email. Try again in a minute." }, 502);
  return json(SENT);
});
