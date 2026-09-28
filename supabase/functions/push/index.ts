// Delivers queued push notifications (see migration 20260927000200_push.sql).
//
// The database calls this when notify.push_outbox has something waiting. It
// only ever empties that queue, so it needs no caller check: calling it with
// nothing queued does nothing. Deployed with verify_jwt off for that reason.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

interface Row { id: number; endpoint: string; p256dh: string; auth: string; title: string; body: string; url: string; tag: string }

Deno.serve(async () => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: vapid, error: vErr } = await db.rpc("push_vapid").single<{ public_key: string | null; private_key: string | null; subject: string | null }>();
  if (vErr) return reply({ error: vErr.message }, 500);
  if (!vapid?.public_key || !vapid.private_key) return reply({ sent: 0, note: "push is not switched on" });
  webpush.setVapidDetails(vapid.subject ?? "mailto:noreply@example.com", vapid.public_key, vapid.private_key);

  let sent = 0, gone = 0;
  // A few batches per call, so a burst (a reminder to everyone) clears in one go.
  for (let batch = 0; batch < 5; batch++) {
    const { data, error } = await db.rpc("push_claim", { p_limit: 200 });
    if (error) return reply({ error: error.message, sent }, 500);
    const rows = (data ?? []) as Row[];
    if (!rows.length) break;
    const dead: string[] = [];
    await Promise.all(rows.map(async (r) => {
      try {
        await webpush.sendNotification(
          { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
          JSON.stringify({ title: r.title, body: r.body, url: r.url, tag: r.tag }),
          { TTL: 6 * 3600, urgency: "high" },
        );
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.push(r.endpoint);
        else console.error("push failed", status, (e as Error).message);
      }
    }));
    gone += dead.length;
    const ids = [...new Set(rows.map((r) => r.id))];
    const { error: fErr } = await db.rpc("push_finish", { p_ids: ids, p_gone: dead });
    if (fErr) return reply({ error: fErr.message, sent }, 500);
  }
  return reply({ sent, gone });
});

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
