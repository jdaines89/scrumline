-- An off-site copy of the nightly backup. The backups in backup.snapshots live
-- in the same Supabase project as the data, so losing or pausing the project
-- would lose them too. Each night, after backup.take() (23:15 UTC), the latest
-- slot is compressed, encrypted with a passphrase from Vault and emailed to the
-- admins as an attachment. The file is a standard OpenPGP symmetric message:
--   gpg --decrypt scrumline-backup-YYYY-MM-DD.pgp     (asks for the passphrase)
-- gives back one JSON object, {table name: [rows...]}. Restore from it the same
-- way as from a slot (see 20261005000100_nightly_backups.sql).
--
-- The passphrase is Vault secret 'backup_passphrase'; with none set, nothing is
-- sent and the alarm (notify.watchdog) says so. Brevo caps an email at about
-- 4 MB, so a file over 3 MB (base64) is not sent and the alarm says so too.
--
-- Additive only.
create extension if not exists pgcrypto;

create table if not exists backup.offsite (
  id         bigint generated always as identity primary key,
  sent_at    timestamptz not null default now(),
  request_id bigint,                -- the pg_net request, to read Brevo's answer
  bytes      integer not null,
  tables     integer not null,
  note       text
);
revoke all on backup.offsite from public, anon, authenticated;
-- A starting point, so the alarm waits 30 hours for the first email before complaining.
insert into backup.offsite (request_id, bytes, tables, note)
select null, 0, 0, null where not exists (select 1 from backup.offsite);

-- Tonight's file: its name, the encrypted base64 body, and what is inside.
create or replace function backup.offsite_payload()
returns table (file_name text, body text, tables integer, total_rows bigint)
language plpgsql
security definer
set search_path = extensions, public, pg_temp
as $$
declare
  pass text;
  s smallint;
  j jsonb;
begin
  select decrypted_secret into pass from vault.decrypted_secrets where name = 'backup_passphrase';
  if pass is null or length(pass) < 16 then return; end if;
  select x.slot into s from backup.snapshots x order by x.taken_at desc limit 1;
  if s is null then return; end if;
  select jsonb_object_agg(x.tbl, x.rows), count(*), coalesce(sum(x.row_count), 0)
    into j, tables, total_rows from backup.snapshots x where x.slot = s;
  file_name := 'scrumline-backup-' || to_char(now() at time zone 'Africa/Johannesburg', 'YYYY-MM-DD') || '.pgp';
  body := replace(encode(pgp_sym_encrypt(j::text, pass, 'compress-algo=2, cipher-algo=aes256'), 'base64'), E'\n', '');
  return next;
end $$;
revoke all on function backup.offsite_payload() from public, anon, authenticated;

-- Emails tonight's file to every admin. Returns the number of emails queued.
create or replace function backup.send_offsite()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  f record;
  key text;
  cfg jsonb := (select jsonb_object_agg(s.key, s.value) from notify.settings s);
  a record;
  req bigint;
  n integer := 0;
begin
  select * into f from backup.offsite_payload();
  if f.body is null then return 0; end if;
  if length(f.body) > 3000000 then
    insert into backup.offsite (request_id, bytes, tables, note) values (null, length(f.body), f.tables, 'too big to email');
    return 0;
  end if;
  select decrypted_secret into key from vault.decrypted_secrets where name = 'brevo_api_key';
  if key is null or to_regproc('net.http_post') is null then return 0; end if;
  for a in select m.display_name, m.email from public.members m where m.is_admin and m.email is not null loop
    req := net.http_post(
      url := 'https://api.brevo.com/v3/smtp/email',
      headers := jsonb_build_object('api-key', key, 'content-type', 'application/json', 'accept', 'application/json'),
      body := jsonb_build_object(
        'sender', jsonb_build_object('email', cfg ->> 'sender_email', 'name', cfg ->> 'sender_name'),
        'to', jsonb_build_array(jsonb_build_object('email', a.email, 'name', a.display_name)),
        'subject', 'Scrumline backup ' || to_char(now() at time zone 'Africa/Johannesburg', 'YYYY-MM-DD'),
        'htmlContent', '<p>Tonight''s encrypted backup is attached: ' || f.tables || ' tables, ' || f.total_rows
                       || ' rows. Keep it somewhere safe and do not forward it. It opens only with the backup passphrase.</p>',
        'attachment', jsonb_build_array(jsonb_build_object('name', f.file_name, 'content', f.body))));
    insert into backup.offsite (request_id, bytes, tables) values (req, length(f.body), f.tables);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function backup.send_offsite() from public, anon, authenticated;

-- The alarm learns about it: no copy sent for 30 hours, or Brevo refused the last one.
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
  o record;
  refused boolean := false;
begin
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

  -- The off-site copy: sent recently, and not refused.
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
end $$;
revoke all on function notify.problems(timestamptz) from public, anon, authenticated;

-- 15 minutes after backup.take(), so tonight's slot is the one that goes out.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('offsite-backup', '30 23 * * *', 'select backup.send_offsite()');
  end if;
end $$;
