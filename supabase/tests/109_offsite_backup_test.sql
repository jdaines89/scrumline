-- The off-site backup: an encrypted file anyone with the passphrase can open,
-- nothing sent without one, and the alarm when no copy goes out.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;

reset role;
begin;
select backup.take();
delete from vault.decrypted_secrets where name = 'backup_passphrase';
select pg_temp.check(not exists (select 1 from backup.offsite_payload()), 'with no passphrase nothing is prepared');
select pg_temp.check(backup.send_offsite() = 0, 'and nothing is sent');

insert into vault.decrypted_secrets (name, decrypted_secret) values ('backup_passphrase', 'a-long-test-passphrase-1234');
select (select body from backup.offsite_payload()) as body \gset
select pg_temp.check(:'body' <> '' and :'body' not like '%matches%' and :'body' !~ E'\\s', 'the file is encrypted base64 with no readable table names');
select pg_temp.check((select (pgp_sym_decrypt(decode(:'body', 'base64'), 'a-long-test-passphrase-1234')::jsonb) ? 'matches'), 'the passphrase opens it');
select pg_temp.check((select tables > 10 and total_rows > 0 and file_name like 'scrumline-backup-%.pgp' from backup.offsite_payload()), 'named by date, with counts');
select pg_temp.check(not has_function_privilege('authenticated', 'backup.send_offsite()', 'execute'), 'players cannot send it');

-- the alarm
update public.seasons set is_replay = true;
delete from backup.offsite;
insert into backup.offsite (sent_at, request_id, bytes, tables) values (now() - interval '2 hours', null, 1, 1);
select pg_temp.check(not exists (select 1 from notify.problems() where kind = 'offsite'), 'a recent copy is fine');
update backup.offsite set sent_at = now() - interval '31 hours';
update backup.snapshots set taken_at = now();
select pg_temp.check(exists (select 1 from notify.problems() where kind = 'offsite'), 'no copy for over 30 hours raises the alarm');
update backup.offsite set sent_at = now() - interval '2 hours', note = 'too big to email';
select pg_temp.check((select detail like '%too big%' from notify.problems() where kind = 'offsite'), 'a file too big to email says so');

do $$ begin raise notice 'OFFSITE BACKUP CHECKS PASSED'; end $$;
rollback;
