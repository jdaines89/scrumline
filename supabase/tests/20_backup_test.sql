-- Nightly backups: snapshot, non-destructive restore, and locked away from players.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;

create table public.zz_probe (
  id    bigint generated always as identity primary key,
  name  text not null,
  shout text generated always as (upper(name)) stored
);
insert into public.zz_probe (name) values ('ann'), ('ben'), ('cat');

select pg_temp.check(backup.take() > 2, 'a snapshot saves every public table');
select pg_temp.check(not exists (select 1 from backup.snapshots where tbl = 'schools'), 'the schools reference list is left out');
select pg_temp.check((select row_count from backup.snapshots where tbl = 'zz_probe') = 3, 'new tables are picked up on their own');
select pg_temp.check(exists (select 1 from backup.snapshots where tbl = 'auth.users'), 'sign-in identities are saved');

do $$ declare s integer := backup.slot_for((now() at time zone 'Africa/Johannesburg')::date); n integer; begin
  delete from public.zz_probe where name in ('ben', 'cat');
  update public.zz_probe set name = 'annie' where name = 'ann';
  n := backup.restore_missing('zz_probe', s);
  perform pg_temp.check(n = 2, 'restore brings back only the missing rows');
  perform pg_temp.check((select name from public.zz_probe where id = 1) = 'annie', 'restore never overwrites a row that exists');
  perform pg_temp.check((select shout from public.zz_probe where name = 'cat') = 'CAT', 'generated columns are recomputed');
  perform pg_temp.check(backup.take() > 2 and (select count(*) from backup.list()) = 1, 'a second run the same day overwrites its slot');
end $$;

set role authenticated;
do $$ begin
  perform backup.take();
  raise exception 'FAILED: a player could run a backup';
exception when insufficient_privilege then raise notice 'ok: players can''t run or read backups';
end $$;
reset role;

drop table public.zz_probe;
do $$ begin raise notice 'BACKUP CHECKS PASSED'; end $$;
