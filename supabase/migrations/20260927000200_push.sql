-- Push notifications, to replace most reminder emails and to tell you when
-- you're tagged in chat.
--
-- How it fits together:
--   1. A phone that allows notifications saves its push address in
--      push_subscriptions (one row per device; a person can have several).
--   2. Anything worth telling someone goes into notify.push_outbox: kickoff
--      reminders (instead of an email, for anyone with a device) and chat
--      tags (new; only by push, never by email).
--   3. notify.kick_push() asks the 'push' Edge Function to empty the outbox.
--      It runs straight after a tag and every minute from cron, and does
--      nothing when the outbox is empty, so the free invocation quota isn't
--      spent on idle minutes.
--   4. The Edge Function claims rows (push_claim), signs and encrypts each
--      message with the VAPID key from Vault, sends it to the phone's push
--      service, and reports back (push_finish). Addresses the push service
--      says are gone (the app was removed, permission revoked) are deleted.
-- The VAPID private key lives only in Vault ('vapid_private_key'); the
-- public half and the function's URL are in notify.settings. With no key,
-- nothing is sent and reminders keep going by email.

create table public.push_subscriptions (
  endpoint   text primary key check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  user_id    uuid not null default auth.uid() references public.members(user_id) on delete cascade,
  p256dh     text not null check (length(p256dh) between 40 and 200),
  auth       text not null check (length(auth) between 10 and 100),
  created_at timestamptz not null default now()
);
create index push_subscriptions_user on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;
create policy "your devices" on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy "remove your devices" on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());

-- Saving goes through a function: a phone that changes hands (sign out, sign
-- in as someone else) keeps its push address, which then belongs to the new
-- person rather than failing on the old row.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_member() then raise exception 'Not a member' using errcode = '42501'; end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
end $$;
revoke execute on function public.save_push_subscription(text, text, text) from anon, public;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;

-- Tag notifications can be turned off; kickoff reminders keep using
-- email_reminders, whichever way they're delivered.
alter table public.members add column push_mentions boolean not null default true;
grant update (push_mentions) on public.members to authenticated;

create table notify.push_outbox (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.members(user_id) on delete cascade,
  title      text not null,
  body       text not null,
  url        text not null,
  tag        text not null,               -- a newer message with the same tag replaces the old one on the phone
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  attempts   int not null default 0,
  sent_at    timestamptz
);
create index push_outbox_waiting on notify.push_outbox (id) where sent_at is null;

insert into notify.settings (key, value) values
  ('push_url', 'https://lgqhimcthptxglqppnuf.supabase.co/functions/v1/push'),
  ('vapid_subject', 'https://jdaines89.github.io/scrumline/')
on conflict (key) do nothing;
-- vapid_public_key is added with the Vault secret when push goes live.

create or replace function notify.kick_push()
returns void
language plpgsql
security definer
set search_path = public, notify
as $$
declare
  url text := (select value from notify.settings where key = 'push_url');
begin
  delete from notify.push_outbox where created_at < now() - interval '7 days';
  if url is null or to_regproc('net.http_post') is null then return; end if;
  if not exists (select 1 from notify.push_outbox
                 where sent_at is null and attempts < 3
                   and (claimed_at is null or claimed_at < now() - interval '2 minutes')) then
    return;
  end if;
  perform net.http_post(url := url, body := '{}'::jsonb,
                        headers := jsonb_build_object('content-type', 'application/json'));
end $$;

-- The app's link for a screen, e.g. notify.app_link('chat/?pool=4').
create or replace function notify.app_link(p_path text)
returns text
language sql stable
set search_path = public, notify
as $$
  select regexp_replace((select value from notify.settings where key = 'app_url'), '[^/]*/$', '') || p_path
$$;

-- Chat text as a person reads it: tags become @Name.
create or replace function notify.plain_chat(p_body text)
returns text
language plpgsql stable
set search_path = public
as $$
declare
  out text := p_body;
  t text[];
begin
  for t in select regexp_matches(p_body, '<@([0-9a-f-]{36})>', 'g') loop
    out := replace(out, '<@' || t[1] || '>',
                   '@' || coalesce((select display_name from public.members where user_id::text = t[1]), 'someone'));
  end loop;
  return btrim(out);
end $$;

-- You were tagged: one push per tag, unless you tagged yourself or turned
-- tag notifications off. A chat message never fails because of this.
create or replace function notify.queue_mention()
returns trigger
language plpgsql
security definer
set search_path = public, notify
as $$
declare
  msg public.chat_messages;
  text_ text;
begin
  begin
    select * into msg from public.chat_messages where id = new.message_id;
    if msg.author_id = new.user_id then return null; end if;
    if not exists (select 1 from public.members where user_id = new.user_id and push_mentions)
       or not exists (select 1 from public.push_subscriptions where user_id = new.user_id) then
      return null;
    end if;
    text_ := notify.plain_chat(msg.body);
    if text_ = '' then text_ := 'Sent a photo'; end if;
    insert into notify.push_outbox (user_id, title, body, url, tag)
    select new.user_id,
           a.display_name || ' tagged you in ' || p.name,
           case when length(text_) > 140 then left(text_, 139) || '…' else text_ end,
           notify.app_link('chat/?pool=' || msg.pool_id),
           'chat-' || msg.pool_id
    from public.members a, public.pools p
    where a.user_id = msg.author_id and p.id = msg.pool_id;
    perform notify.kick_push();
  exception when others then
    raise warning 'push for mention % skipped: %', new.message_id, sqlerrm;
  end;
  return null;
end $$;
create trigger chat_mentions_push after insert on public.chat_mentions
  for each row execute function notify.queue_mention();

-- Kickoff reminders: by push to anyone with a device, by email to the rest.
create or replace function notify.send_reminders()
returns int
language plpgsql
security definer
set search_path = public, notify
as $$
declare
  key text;
  d record;
  rid bigint;
  n int := 0;
  pushed int := 0;
  cfg jsonb := (select jsonb_object_agg(s.key, s.value) from notify.settings s);
  push_on boolean := exists (select 1 from notify.settings s where s.key = 'vapid_public_key');
begin
  select decrypted_secret into key from vault.decrypted_secrets where name = 'brevo_api_key';
  for d in select * from notify.due_reminders() loop
    rid := null;
    if push_on and exists (select 1 from public.push_subscriptions ps where ps.user_id = d.user_id) then
      insert into notify.push_outbox (user_id, title, body, url, tag)
      values (d.user_id,
              case when cardinality(d.match_ids) = 1 then 'Kickoff in under an hour'
                   else 'Kickoff in under an hour: ' || cardinality(d.match_ids) || ' scores to call' end,
              'You haven''t called ' || array_to_string(d.lines, ', ') || '. It locks at kickoff.',
              cfg ->> 'app_url',
              'kickoff');
      pushed := pushed + 1;
    elsif key is not null then
      rid := net.http_post(
        url := 'https://api.brevo.com/v3/smtp/email',
        headers := jsonb_build_object('api-key', key, 'content-type', 'application/json', 'accept', 'application/json'),
        body := jsonb_build_object(
          'sender', jsonb_build_object('email', cfg ->> 'sender_email', 'name', cfg ->> 'sender_name'),
          'to', jsonb_build_array(jsonb_build_object('email', d.email, 'name', d.display_name)),
          'subject', case when cardinality(d.match_ids) = 1 then 'Kickoff in under an hour: call your score'
                          else 'Kickoff in under an hour: ' || cardinality(d.match_ids) || ' scores to call' end,
          'htmlContent',
            '<p>Hi ' || replace(replace(replace(d.display_name, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || ',</p>'
            || '<p>You haven''t called a score for:</p><ul><li>'
            || array_to_string(d.lines, '</li><li>')
            || '</li></ul><p>Times are SA time. <a href="' || (cfg ->> 'app_url') || '">Call it now</a> before it locks at kickoff.</p>'
            || '<p style="color:#888;font-size:12px">You can turn these off on your profile.</p>'
        )
      );
    else
      continue;
    end if;
    insert into notify.reminders_sent (user_id, match_id, request_id)
    select d.user_id, x, rid from unnest(d.match_ids) x
    on conflict do nothing;
    n := n + 1;
  end loop;
  if pushed > 0 then perform notify.kick_push(); end if;
  return n;
end;
$$;

-- For the Edge Function only (it signs in with the service role).
create or replace function public.push_vapid()
returns table (public_key text, private_key text, subject text)
language sql stable
security definer
set search_path = public, notify
as $$
  select (select value from notify.settings where key = 'vapid_public_key'),
         (select decrypted_secret from vault.decrypted_secrets where name = 'vapid_private_key'),
         (select value from notify.settings where key = 'vapid_subject')
$$;

-- Hands out waiting messages, one row per device, and marks them taken so
-- two runs never send the same message. A run that dies leaves them to be
-- retried after two minutes, three tries at most.
create or replace function public.push_claim(p_limit int default 100)
returns table (id bigint, endpoint text, p256dh text, auth text, title text, body text, url text, tag text)
language sql
security definer
set search_path = public, notify
as $$
  with picked as (
    select o.id from notify.push_outbox o
    where o.sent_at is null and o.attempts < 3
      and (o.claimed_at is null or o.claimed_at < now() - interval '2 minutes')
    order by o.id
    limit p_limit
    for update skip locked
  ), taken as (
    update notify.push_outbox o set claimed_at = now(), attempts = o.attempts + 1
    from picked where o.id = picked.id
    returning o.*
  )
  select t.id, s.endpoint, s.p256dh, s.auth, t.title, t.body, t.url, t.tag
  from taken t join public.push_subscriptions s on s.user_id = t.user_id
$$;

create or replace function public.push_finish(p_ids bigint[], p_gone text[])
returns void
language sql
security definer
set search_path = public, notify
as $$
  update notify.push_outbox set sent_at = now() where id = any(p_ids);
  delete from public.push_subscriptions where endpoint = any(p_gone);
$$;

revoke all on function public.push_vapid(), public.push_claim(int), public.push_finish(bigint[], text[])
  from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.push_vapid(), public.push_claim(int), public.push_finish(bigint[], text[])
      to service_role;
  end if;
end $$;

-- The app needs the public half to subscribe a phone.
create or replace function public.push_public_key()
returns text
language sql stable
security definer
set search_path = public, notify
as $$
  select value from notify.settings where key = 'vapid_public_key' and public.is_member()
$$;
revoke execute on function public.push_public_key() from anon, public;
grant execute on function public.push_public_key() to authenticated;

revoke all on all functions in schema notify from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('push-send', '* * * * *', 'select notify.kick_push()');
  end if;
end $$;
