// Starts a sponsor's card payment for a held booking.
//
// The caller's own session reads the booking, so row-level security decides
// whether it's theirs. The price comes from the booking, never the request.
// Paystack splits the money at source when PAYSTACK_SPLIT_CODE is set (the
// Foundation's 40% to its subaccount). Without PAYSTACK_SECRET_KEY nothing
// can be charged; a sk_test_ key runs in test mode with test cards only.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!secret) return json({ error: "Payments aren't switched on yet." }, 503);

  const { booking_id, return_url } = await req.json().catch(() => ({}));
  if (!Number.isInteger(booking_id)) return json({ error: "Which booking?" }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: b } = await db.from("sponsor_bookings")
    .select("id, status, held_until, price_minor, currency, sponsors(email)")
    .eq("id", booking_id).maybeSingle();
  if (!b) return json({ error: "Not your booking." }, 404);
  if (b.status !== "held" || new Date(b.held_until) <= new Date()) {
    return json({ error: "This hold has expired. Pick the slot again." }, 409);
  }

  // Only our own pages may be the return address.
  const site = Deno.env.get("SITE_URL") ?? "https://jdaines89.github.io/scrumline";
  const back = typeof return_url === "string" && return_url.startsWith(site + "/") ? return_url : `${site}/sponsor/`;

  const reference = `slb-${b.id}-${crypto.randomUUID().slice(0, 8)}`;
  const body: Record<string, unknown> = {
    email: (b.sponsors as unknown as { email: string }).email,
    amount: b.price_minor,
    currency: b.currency,
    reference,
    callback_url: back,
    metadata: { booking_id: b.id },
    channels: ["card", "eft", "bank_transfer"],
  };
  const split = Deno.env.get("PAYSTACK_SPLIT_CODE");
  if (split) body.split_code = split;

  const res = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok || !out?.status) return json({ error: "The payment page couldn't be opened. Try again." }, 502);
  return json({ url: out.data.authorization_url, reference, test: secret.startsWith("sk_test_") });
});
