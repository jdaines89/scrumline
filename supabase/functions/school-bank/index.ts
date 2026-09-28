// A school's bank account, checked and turned into a Paystack transfer
// recipient. The full account number goes to Paystack and nowhere else: the
// database keeps the bank, the last 4 digits and the recipient code.
//
//   { action: "banks" }  the South African banks Paystack pays into
//   { action: "claim", bank_code, bank_name, account_number, account_name, registration? }
//       the signed-in school account claims its school
//   { action: "claim", ..., assisted: { emis, contact, role, phone, language } }
//       an admin records a school they look after, to be paid by EFT
//
// Paystack confirms in South Africa that an account is open, takes payments
// and is held under the name and registration number given (/bank/validate).
// The database then checks that name belongs to the school. Both pass: the
// claim is verified; otherwise it waits for an admin.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!secret) return json({ error: "Bank checks switch on with payments. Try again soon." }, 503);
  const ps = (path: string, init?: RequestInit) =>
    fetch(`https://api.paystack.co${path}`, { ...init, headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" } })
      .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => null) }));

  const body = await req.json().catch(() => ({}));
  if (body.action === "banks") {
    const r = await ps("/bank?country=south%20africa&perPage=100");
    if (!r.ok) return json({ error: "Couldn't load the banks." }, 502);
    return json({ banks: (r.body?.data ?? []).filter((b: { active: boolean }) => b.active).map((b: { name: string; code: string }) => ({ name: b.name, code: b.code })) });
  }
  if (body.action !== "claim") return json({ error: "Unknown action" }, 400);

  const auth = req.headers.get("Authorization") ?? "";
  const user = await createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  }).auth.getUser();
  const uid = user.data.user?.id;
  if (!uid) return json({ error: "Sign in first." }, 401);

  const bankCode = clean(body.bank_code, 20), bankName = clean(body.bank_name, 60);
  const number = clean(body.account_number, 20).replace(/\D/g, "");
  const holder = clean(body.account_name, 100), registration = clean(body.registration, 40);
  if (!bankCode || !bankName || !/^\d{6,16}$/.test(number) || holder.length < 2) {
    return json({ error: "Check the bank, the account number and the name on the account." }, 400);
  }

  // Is the account open, taking payments, and held under this name?
  let confirmed = false;
  if (registration) {
    const v = await ps("/bank/validate", { method: "POST", body: JSON.stringify({
      bank_code: bankCode, country_code: "ZA", account_number: number, account_name: holder,
      account_type: "business", document_type: "businessRegistrationNumber", document_number: registration,
    }) });
    const d = v.body?.data ?? {};
    confirmed = v.ok && d.verified === true && d.accountHolderMatch === true && d.accountOpen === true && d.accountAcceptsCredits === true;
  }

  const r = await ps("/transferrecipient", { method: "POST", body: JSON.stringify({
    type: "basa", name: holder, account_number: number, bank_code: bankCode, currency: "ZAR",
  }) });
  const recipient = r.body?.data?.recipient_code;
  if (!r.ok || !recipient) return json({ error: "The bank didn't accept that account. Check the details." }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const last4 = number.slice(-4);
  if (body.assisted) {
    const a = body.assisted;
    const { error } = await db.rpc("record_assisted_claim", {
      p_admin: uid, p_emis: clean(a.emis, 20), p_contact: clean(a.contact, 60), p_role: clean(a.role, 20),
      p_phone: clean(a.phone, 20), p_language: clean(a.language, 3), p_mode: "transfer",
      p_bank_name: bankName, p_last4: last4, p_account_name: holder, p_recipient: recipient,
    });
    if (error) return json({ error: error.message }, error.code === "42501" ? 403 : 400);
    return json({ status: "verified" });
  }
  const { data, error } = await db.rpc("record_school_claim", {
    p_user: uid, p_bank_name: bankName, p_last4: last4, p_account_name: holder, p_bank_confirmed: confirmed, p_recipient: recipient,
  });
  if (error) return json({ error: "Couldn't save the claim. Try again in a minute." }, 502);
  if (data === "already claimed") return json({ error: "Someone has already claimed this school. If that's wrong, email us." }, 409);
  if (data === "pick your school first") return json({ error: "Pick your school first." }, 400);
  return json({ status: data === "already claimed by you" ? "unchanged" : data });
});
