-- The alarm: finished matches with no score, failing jobs, a missed backup.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;

reset role;
begin;
-- Everything below is undone at the end; other tournaments' fixtures stay out of the way.
update public.seasons set is_replay = true;
insert into public.seasons (id, name, is_replay, competition_id, feed_season, starts_on)
  values ('wd-test', 'Watchdog test', false, '5069', 'wd', '2026-10-01');
insert into public.matches (id, season, round, kickoff_at, home_team_id, away_team_id, venue, status, source)
  values ('wd-1', 'wd-test', 1, '2026-10-10 12:00+00', '142072', '142073', 'Test', 'SCHEDULED', 'test');
-- A fresh backup, so only the match can raise the alarm.
insert into backup.snapshots (slot, tbl, taken_at, row_count, rows)
  values (0, 'wd-test', '2026-10-10 23:15+00', 0, '[]')
  on conflict (slot, tbl) do update set taken_at = excluded.taken_at;
delete from backup.snapshots where tbl <> 'wd-test';
insert into backup.offsite (sent_at, request_id, bytes, tables) values ('2026-10-12 00:00+00', null, 1, 1);
update backup.offsite set sent_at = '2026-10-12 00:00+00';

select pg_temp.check(not exists (select 1 from notify.problems('2026-10-10 15:00+00')),
                     'no alarm 3 hours after kickoff: results lag');
select pg_temp.check((select detail like '1 match has no score%' from notify.problems('2026-10-10 17:00+00') where kind = 'scores'),
                     'a match with no score 5 hours after kickoff raises the scores alarm');
update public.matches set status = 'FT', home_score = 20, away_score = 10 where id = 'wd-1';
select pg_temp.check(not exists (select 1 from notify.problems('2026-10-10 17:00+00') where kind = 'scores'),
                     'a scored match clears it');
update public.matches set status = 'SCHEDULED', home_score = null, away_score = null where id = 'wd-1';
select pg_temp.check(not exists (select 1 from notify.problems('2026-10-20 17:00+00') where kind = 'scores'),
                     'matches older than a week are left alone');
update public.seasons set is_replay = true where id = 'wd-test';
select pg_temp.check(not exists (select 1 from notify.problems('2026-10-10 17:00+00') where kind = 'scores'),
                     'practice tournaments never raise it');

select pg_temp.check(not exists (select 1 from notify.problems('2026-10-11 20:00+00') where kind = 'backup'),
                     'a backup from last night is fine');
select pg_temp.check(exists (select 1 from notify.problems('2026-10-12 08:00+00') where kind = 'backup'),
                     'no backup for over 30 hours raises the backup alarm');

-- Raised once, then quiet for 6 hours, then again; forgotten when it clears.
select pg_temp.check(notify.watchdog('2026-10-12 08:00+00') = 1, 'the alarm is raised');
select pg_temp.check(notify.watchdog('2026-10-12 10:00+00') = 0, 'and stays quiet for 6 hours');
select pg_temp.check(notify.watchdog('2026-10-12 15:00+00') = 1, 'then repeats while the problem remains');
update backup.snapshots set taken_at = '2026-10-12 07:00+00';
select pg_temp.check(notify.watchdog('2026-10-12 16:00+00') = 0, 'a fixed problem raises nothing');
select pg_temp.check(not exists (select 1 from notify.alarms), 'and is forgotten');

select pg_temp.check(not has_function_privilege('authenticated', 'notify.watchdog(timestamptz)', 'execute')
                     and not has_function_privilege('anon', 'notify.alert_admins(text, text)', 'execute'),
                     'players cannot run the alarm');

do $$ begin raise notice 'WATCHDOG CHECKS PASSED'; end $$;
rollback;
