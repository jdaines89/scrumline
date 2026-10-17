-- The feed key lives in one row, so a future key change is one update, and
-- the watchdog warns within 30 minutes when TheSportsDB refuses us.
create table if not exists raw.feed_settings (
  key text primary key,
  value text not null
);
insert into raw.feed_settings (key, value) values ('sportsdb_key', '123')
on conflict (key) do nothing;

create or replace function raw.sportsdb_key() returns text
language sql stable security definer set search_path = '' as $$
  select value from raw.feed_settings where key = 'sportsdb_key'
$$;

-- Make every feed call read the key from the row.
do $$
declare
  f record;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'raw' and p.prokind = 'f'
      and pg_get_functiondef(p.oid) like '%thesportsdb.com/api/v1/json/123/%'
  loop
    execute replace(pg_get_functiondef(f.oid),
      'thesportsdb.com/api/v1/json/123/',
      'thesportsdb.com/api/v1/json/'' || raw.sportsdb_key() || ''/');
  end loop;
end $$;

-- Watchdog: say so when the feed refuses us (403) instead of waiting four
-- hours for matches to show up without scores.
create or replace function notify.problems(p_now timestamptz default now())
returns table(kind text, detail text)
language plpgsql security definer set search_path = '' as $function$
declare
  n integer;
  names text;
  last_backup timestamptz;
  o record;
  refused boolean := false;
begin
  if to_regclass('net._http_response') is not null then
    execute $q$select count(*) from net._http_response r
               where r.status_code in (401, 403) and r.created > $1 - interval '2 hours'
                 and r.content like '%API key%'$q$
      into n using p_now;
    if n > 0 then
      kind := 'feed';
      detail := 'The score feed is refusing our key, so no scores will land. The key is in raw.feed_settings.';
      return next;
    end if;
  end if;

  select count(*) into n
  from public.matches m join public.seasons s on s.id = m.season
  where not s.is_replay and m.status = 'SCHEDULED'
    and m.kickoff_at < p_now - interval '4 hours' and m.kickoff_at > p_now - interval '7 days';
  if n > 0 then
    kind := 'scores';
    detail := n || ' match' || case when n = 1 then ' has' else 'es have' end || ' no score yet, over 4 hours after kickoff.';
    return next;
  end if;

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

  select max(s.taken_at) into last_backup from backup.snapshots s;
  if last_backup is null or last_backup < p_now - interval '30 hours' then
    kind := 'backup';
    detail := 'The nightly backup has not run for over 30 hours.';
    return next;
  end if;

  select * into o from backup.offsite x order by x.sent_at desc limit 1;
  if o.id is not null and o.request_id is not null and to_regclass('net._http_response') is not null then
    execute 'select exists (select 1 from net._http_response r where r.id = $1 and (r.status_code >= 300 or r.timed_out or r.error_msg is not null))'
      into refused using o.request_id;
  end if;
  if o.id is null or o.sent_at < p_now - interval '30 hours' then
    kind := 'offsite';
    detail := 'The off-site backup email has not gone out for over 30 hours.';
    return next;
  elsif refused or o.note is not null then
    kind := 'offsite';
    detail := case when o.note is not null then 'The off-site backup is too big to email.' else 'Brevo refused the off-site backup email.' end;
    return next;
  end if;
end $function$;
