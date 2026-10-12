-- An alarm for the things nobody would otherwise notice: finished matches
-- that never got a score, scheduled jobs that fail, and a missed nightly
-- backup. Every 30 minutes notify.watchdog() looks for each problem; if one
-- is found it tells the admins (a push, or an email when they have no push
-- on) and then stays quiet about that same problem for 6 hours. When a
-- problem clears, it is forgotten, so a later one raises the alarm afresh.
--
-- Additive only. Messages carry counts and job names, never data or SQL.

create table if not exists notify.alarms (
  kind       text primary key,            -- scores | cron | backup
  detail     text not null,
  first_seen timestamptz not null default now(),
  last_sent  timestamptz not null default now()
);
revoke all on notify.alarms from public, anon, authenticated;

-- Today's problems, one row per kind.
create or replace function notify.problems(p_now timestamptz default now())
returns table (kind text, detail text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
  names text;
  last_backup timestamptz;
begin
  -- Played over 4 hours ago (results usually lag 1 to 1.5) and still no score.
  -- Only the last 7 days, so old data cannot keep the alarm ringing.
  select count(*) into n
  from public.matches m join public.seasons s on s.id = m.season
  where not s.is_replay and m.status = 'SCHEDULED'
    and m.kickoff_at < p_now - interval '4 hours' and m.kickoff_at > p_now - interval '7 days';
  if n > 0 then
    kind := 'scores';
    detail := n || ' match' || case when n = 1 then ' has' else 'es have' end || ' no score yet, over 4 hours after kickoff.';
    return next;
  end if;

  -- Scheduled jobs that failed in the last 2 hours (pg_cron only exists on Supabase).
  if to_regclass('cron.job_run_details') is not null then
    execute $q$select count(distinct j.jobname), string_agg(distinct j.jobname, ', ')
               from cron.job_run_details d join cron.job j on j.jobid = d.jobid
               where d.status = 'failed' and d.start_time > $1 - interval '2 hours'$q$
      into n, names using p_now;
    if n > 0 then
      kind := 'cron';
      detail := n || ' scheduled job' || case when n = 1 then ' is' else 's are' end || ' failing: ' || names || '.';
      return next;
    end if;
  end if;

  -- The nightly backup runs at 23:15 UTC; over 30 hours means a night was missed.
  select max(s.taken_at) into last_backup from backup.snapshots s;
  if last_backup is null or last_backup < p_now - interval '30 hours' then
    kind := 'backup';
    detail := 'The nightly backup has not run for over 30 hours.';
    return next;
  end if;
end $$;
revoke all on function notify.problems(timestamptz) from public, anon, authenticated;

-- One message to every admin: push if they have it on, else email.
create or replace function notify.alert_admins(p_title text, p_body text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  key text;
  cfg jsonb := (select jsonb_object_agg(s.key, s.value) from notify.settings s);
  a record;
  n integer := 0;
  pushed integer := 0;
begin
  select decrypted_secret into key from vault.decrypted_secrets where name = 'brevo_api_key';
  for a in select m.user_id, m.email, m.display_name from public.members m where m.is_admin loop
    if exists (select 1 from public.push_subscriptions ps where ps.user_id = a.user_id) then
      insert into notify.push_outbox (user_id, title, body, url, tag)
      values (a.user_id, p_title, p_body, notify.app_link('admin/metrics/'), 'watchdog');
      pushed := pushed + 1;
    elsif key is not null and a.email is not null then
      perform net.http_post(
        url := 'https://api.brevo.com/v3/smtp/email',
        headers := jsonb_build_object('api-key', key, 'content-type', 'application/json', 'accept', 'application/json'),
        body := jsonb_build_object(
          'sender', jsonb_build_object('email', cfg ->> 'sender_email', 'name', cfg ->> 'sender_name'),
          'to', jsonb_build_array(jsonb_build_object('email', a.email, 'name', a.display_name)),
          'subject', p_title,
          'htmlContent', '<p>' || p_body || '</p><p><a href="' || notify.app_link('admin/metrics/') || '">Open Scrumline</a></p>'));
    else
      continue;
    end if;
    n := n + 1;
  end loop;
  if pushed > 0 then perform notify.kick_push(); end if;
  return n;
end $$;
revoke all on function notify.alert_admins(text, text) from public, anon, authenticated;

-- Raises the alarm for new or long-standing problems; returns how many it raised.
create or replace function notify.watchdog(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  p record;
  raised integer := 0;
begin
  delete from notify.alarms where kind not in (select x.kind from notify.problems(p_now) x);
  for p in select x.kind, x.detail from notify.problems(p_now) x loop
    if not exists (select 1 from notify.alarms a where a.kind = p.kind and a.last_sent > p_now - interval '6 hours') then
      perform notify.alert_admins('Scrumline needs a look', p.detail);
      insert into notify.alarms (kind, detail, first_seen, last_sent) values (p.kind, p.detail, p_now, p_now)
      on conflict (kind) do update set detail = excluded.detail, last_sent = excluded.last_sent;
      raised := raised + 1;
    end if;
  end loop;
  return raised;
end $$;
revoke all on function notify.watchdog(timestamptz) from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('watchdog', '*/30 * * * *', 'select notify.watchdog()');
  end if;
end $$;
