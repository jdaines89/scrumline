-- Sign-in codes can be longer than 6 digits.
--
-- Supabase's one-time codes for this project are not 6 digits, so
-- send_login_code rejected every one ("bad code") and no newcomer invited by
-- link could get their code (first seen 2026-10-07). Accept the 6 to 10 digits
-- Supabase can be set to make; the app's code box accepts the same.
create or replace function public.send_login_code(p_email text, p_code text, p_purpose text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  key text;
  cfg jsonb := (select jsonb_object_agg(s.key, s.value) from notify.settings s);
  addr text := lower(btrim(p_email));
  rid bigint;
begin
  if p_code !~ '^[0-9]{6,10}$' then raise exception 'bad code'; end if;
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
