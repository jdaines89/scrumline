-- A call can only go on the entry for the match's own tournament.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;

insert into public.seasons (id, name, is_replay, competition_id, feed_season, starts_on)
values ('own-a', 'Own Test A', false, 'varsity-cup', 'own-a', current_date),
       ('own-b', 'Own Test B', false, 'varsity-cup', 'own-b', current_date);
create temp table t_teams as select array_agg(id order by id) as t from (select id from public.teams order by id limit 2) x;
insert into public.matches (id, season, round, kickoff_at, home_team_id, away_team_id, status, source)
select v.id, v.s, 1, now() + interval '3 days', t[1], t[2], 'SCHEDULED', 'test'
from t_teams, (values ('own-a1', 'own-a'), ('own-b1', 'own-b')) as v(id, s);
insert into public.entries (season, team_name, user_id)
values ('own-a', 'Own A XV', '00000000-0000-0000-0000-00000000000a'),
       ('own-b', 'Own B XV', '00000000-0000-0000-0000-00000000000a');

select set_config('role', 'authenticated', false), set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into public.predictions (entry_id, match_id, home_score, away_score)
select id, 'own-b1', 24, 17 from public.entries where season = 'own-b';
select pg_temp.check(exists (select 1 from public.predictions p join public.entries e on e.id = p.entry_id where e.season = 'own-b' and p.match_id = 'own-b1'),
  'a call goes on its own tournament''s entry');
do $$ begin
  insert into public.predictions (entry_id, match_id, home_score, away_score)
  select id, 'own-b1', 24, 17 from public.entries where season = 'own-a';
  raise exception 'FAILED: a call went on another tournament''s entry';
exception when sqlstate 'P0001' then raise notice 'ok: a call on another tournament''s entry is refused';
end $$;
insert into public.match_locks (entry_id, match_id)
select id, 'own-b1' from public.entries where season = 'own-b';
select pg_temp.check(exists (select 1 from public.match_locks l join public.entries e on e.id = l.entry_id where e.season = 'own-b'),
  'locking the call works');

do $$ begin raise notice 'OWN TOURNAMENT CHECKS PASSED'; end $$;
