-- Sign in with a 6-digit code instead of a link and a password.
--
-- Before: a newcomer typed their email, left the app for their inbox, tapped
-- an invite link (often opening a different browser), chose a password, and
-- only then got in. Many never came back from the inbox.
-- Now: the join function asks Supabase for a one-time code without sending
-- Supabase's own email, and this function emails just the code through Brevo.
-- The newcomer types it into the same screen and is in. Players who already
-- have an account can sign in the same way on a new phone; passwords keep
-- working for anyone who has one.
--
-- Only the join edge function (service role) can call these. Codes are not
-- stored here, only when one was sent, for the rate limit.
create table if not exists notify.login_codes (
  id         bigint generated always as identity primary key,
  email      text not null,
  purpose    text not null check (purpose in ('join', 'signin')),
  sent_at    timestamptz not null default now(),
  request_id bigint
);
create index if not exists login_codes_email on notify.login_codes (email, sent_at);
revoke all on notify.login_codes from public, anon, authenticated;

-- Whether an email belongs to an account that can sign in (a player, business or school).
create or replace function public.login_email_known(p_email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.users u where lower(u.email) = lower(btrim(p_email)))
$$;
revoke all on function public.login_email_known(text) from public, anon, authenticated;
grant execute on function public.login_email_known(text) to service_role;

-- Emails the code. At most 5 codes an hour per address and 60 an hour in all,
-- so the link can't be used to flood an inbox or burn the free email quota.
-- Returns 'sent', 'limited' or 'no-mail' (email not set up).
create or replace function public.send_login_code(p_email text, p_code text, p_purpose text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  key text;
  cfg jsonb := (select jsonb_object_agg(s.key, s.value) from notify.settings s);
  addr text := lower(btrim(p_email));
  rid bigint;
begin
  if p_code !~ '^[0-9]{6}$' then raise exception 'bad code'; end if;
  if (select count(*) from notify.login_codes where email = addr and sent_at > now() - interval '1 hour') >= 5
     or (select count(*) from notify.login_codes where sent_at > now() - interval '1 hour') >= 60 then
    return 'limited';
  end if;
  select decrypted_secret into key from vault.decrypted_secrets where name = 'brevo_api_key';
  if key is null then return 'no-mail'; end if;
  rid := net.http_post(
    url := 'https://api.brevo.com/v3/smtp/email',
    headers := jsonb_build_object('api-key', key, 'content-type', 'application/json', 'accept', 'application/json'),
    body := jsonb_build_object(
      'sender', jsonb_build_object('email', cfg ->> 'sender_email', 'name', cfg ->> 'sender_name'),
      'to', jsonb_build_array(jsonb_build_object('email', addr)),
      'subject', p_code || ' is your Scrumline code',
      'htmlContent',
        '<p>Your Scrumline code is:</p>'
        || '<p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:12px 0">' || p_code || '</p>'
        || '<p>Type it into the screen you just came from. It works for an hour.</p>'
        || '<p style="color:#888;font-size:12px">If you didn''t ask for this, ignore this email. Nobody can get in without the code.</p>'
    )
  );
  insert into notify.login_codes (email, purpose, request_id) values (addr, p_purpose, rid);
  return 'sent';
end $$;
revoke all on function public.send_login_code(text, text, text) from public, anon, authenticated;
grant execute on function public.send_login_code(text, text, text) to service_role;
