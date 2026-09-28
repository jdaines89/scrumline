// Paystack tells us a payment went through. This is the only way a booking
// becomes paid: the message must carry Paystack's signature (HMAC-SHA512 of
// the raw body with our secret key), and we then ask Paystack directly for
// the transaction before trusting its amount. Deployed with verify_jwt off,
// because Paystack has no Supabase session; the signature is the check.
import { createClient } from "npm:@supabase/supabase-js@2";

async function hmac512(key: string, body: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!secret || req.method !== "POST") return new Response("no", { status: 400 });

  const raw = await req.text();
  const given = req.headers.get("x-paystack-signature") ?? "";
  if (!same(await hmac512(secret, raw), given.toLowerCase())) return new Response("bad signature", { status: 401 });

  const event = JSON.parse(raw);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // A payout to a school landed, failed or came back.
  if (/^transfer\.(success|failed|reversed)$/.test(event?.event ?? "")) {
    const ref: string = event.data?.reference ?? "";
    if (!ref.startsWith("slp-")) return new Response("not ours");
    const ok = event.event === "transfer.success";
    const { data, error } = await db.rpc("school_payout_result", {
      p_reference: ref, p_ok: ok, p_transfer_code: event.data?.transfer_code ?? null,
      p_failure: ok ? null : String(event.data?.reason ?? event.data?.gateway_response ?? event.event),
    });
    if (error) return new Response("retry", { status: 500 });
    console.log(`payout ${ref}: ${data}`);
    return new Response(String(data));
  }
  if (event?.event !== "charge.success") return new Response("ignored");
  const reference: string = event.data?.reference ?? "";
  const m = /^slb-(\d+)-/.exec(reference);
  if (!m) return new Response("not ours");

  // Belt and braces: the amount we record is what Paystack says it settled.
  const check = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const tx = (await check.json().catch(() => null))?.data;
  if (!check.ok || tx?.status !== "success") return new Response("not settled", { status: 409 });

  const { data, error } = await db.rpc("sponsor_booking_paid", {
    p_booking: Number(m[1]), p_provider: "paystack", p_ref: reference,
    p_amount_minor: tx.amount, p_currency: tx.currency,
  });
  if (error) return new Response("retry", { status: 500 });  // Paystack retries
  // 'ok' and 'already paid' are done. Anything else needs a person (a refund).
  console.log(`booking ${m[1]}: ${data}`);
  return new Response(String(data));
});
