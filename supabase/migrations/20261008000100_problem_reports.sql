-- "Report a problem": any player (or someone who can't sign in) can tell us what went wrong.
-- Written only through report_problem(), which rate-limits and emails the admins.
-- Players can read their own reports; admins see all of them on the moderation page.

create table if not exists public.problem_reports (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  email text,
  body text not null check (char_length(body) between 3 and 2000),
  page text,
  error text,
  device text,
  ip text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists problem_reports_recent on public.problem_reports (created_at desc);

alter table public.problem_reports enable row level security;
revoke all on public.problem_reports from anon, authenticated;
grant select (id, body, page, created_at, done_at) on public.problem_reports to authenticated;
create policy problem_reports_own on public.problem_reports for select to authenticated using (user_id = auth.uid());

create or replace function public.report_problem(p_body text, p_page text default null, p_error text default null,
                                                 p_device text default null, p_email text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  ip text := split_part(coalesce(current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for', ''), ',', 1);
  mail text := coalesce((select u.email from auth.users u where u.id = me), nullif(trim(p_email), ''));
  key text;
  cfg jsonb := (select jsonb_object_agg(s.key, s.value) from notify.settings s);
  a record;
  html text;
  esc_body text;
  new_id bigint;
begin
  p_body := trim(coalesce(p_body, ''));
  if char_length(p_body) < 3 then raise exception 'Tell us a little about what happened.'; end if;
  if mail is not null and mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email doesn''t look right.'; end if;

  -- Limits: 5 an hour per player or per connection, and 40 an hour from people not signed in, so it can't flood Justin's inbox.
  if (select count(*) from public.problem_reports r where r.created_at > now() - interval '1 hour'
        and ((me is not null and r.user_id = me) or (me is null and ip <> '' and r.ip = ip))) >= 5
     or (me is null and (select count(*) from public.problem_reports r
                         where r.user_id is null and r.created_at > now() - interval '1 hour') >= 40) then
    raise exception 'Thanks, we already have your reports. Give us a little time to look.';
  end if;

  insert into public.problem_reports (user_id, email, body, page, error, device, ip)
  values (me, left(mail, 200), left(p_body, 2000), left(p_page, 300), left(p_error, 1000), left(p_device, 300), nullif(ip, ''))
  returning id into new_id;

  select decrypted_secret into key from vault.decrypted_secrets where name = 'brevo_api_key';
  if key is not null then
    esc_body := replace(replace(replace(p_body || coalesce(E'\n\nError: ' || p_error, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
    html := '<p><strong>' || coalesce((select m.display_name from public.members m where m.user_id = me), 'Someone not signed in')
            || '</strong> (' || coalesce(replace(replace(mail, '<', ''), '>', ''), 'no email') || ') reported a problem:</p>'
            || '<p style="white-space:pre-wrap">' || esc_body || '</p>'
            || '<p style="color:#888;font-size:12px">Page: ' || replace(replace(coalesce(p_page, '?'), '<', ''), '>', '')
            || '<br>Device: ' || replace(replace(coalesce(p_device, '?'), '<', ''), '>', '') || '</p>'
            || '<p><a href="' || replace(cfg ->> 'app_url', '/predict/', '/admin/moderation/') || '">See all reports</a></p>';
    for a in select u.email, m.display_name from public.members m join auth.users u on u.id = m.user_id where m.is_admin loop
      perform net.http_post(
        url := 'https://api.brevo.com/v3/smtp/email',
        headers := jsonb_build_object('api-key', key, 'content-type', 'application/json', 'accept', 'application/json'),
        body := jsonb_build_object(
          'sender', jsonb_build_object('email', cfg ->> 'sender_email', 'name', cfg ->> 'sender_name'),
          'to', jsonb_build_array(jsonb_build_object('email', a.email, 'name', a.display_name)),
          'replyTo', case when mail is not null then jsonb_build_object('email', mail) end,
          'subject', 'Problem report #' || new_id,
          'htmlContent', html
        ) - case when mail is null then 'replyTo' else '' end
      );
    end loop;
  end if;
  return 'sent';
end $$;
revoke execute on function public.report_problem(text, text, text, text, text) from public;
grant execute on function public.report_problem(text, text, text, text, text) to anon, authenticated;

create or replace function public.mod_problems(p_limit int default 50)
returns table (id bigint, name text, email text, body text, page text, error text, device text, created_at timestamptz, done_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.members where user_id = auth.uid() and is_admin) then raise exception 'Admins only'; end if;
  return query
    select r.id, m.display_name, r.email, r.body, r.page, r.error, r.device, r.created_at, r.done_at
    from public.problem_reports r left join public.members m on m.user_id = r.user_id
    order by (r.done_at is null) desc, r.created_at desc limit least(p_limit, 200);
end $$;
revoke execute on function public.mod_problems(int) from public, anon;
grant execute on function public.mod_problems(int) to authenticated;

create or replace function public.mod_problem_done(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.members where user_id = auth.uid() and is_admin) then raise exception 'Admins only'; end if;
  update public.problem_reports set done_at = coalesce(done_at, now()) where id = p_id;
end $$;
revoke execute on function public.mod_problem_done(bigint) from public, anon;
grant execute on function public.mod_problem_done(bigint) to authenticated;
