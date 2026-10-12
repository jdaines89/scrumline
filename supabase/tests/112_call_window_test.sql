-- Calls open 14 days before kickoff; older calls stay; owner SQL is exempt.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;

insert into public.seasons (id, name, is_replay, competition_id, feed_season, starts_on)
values ('window-test', 'Window Test Cup', false, 'varsity-cup', 'window-test', current_date);
create temp table t_teams as select array_agg(id order by id) as t from (select id from public.teams order by id limit 4) x;
insert into public.matches (id, season, round, kickoff_at, home_team_id, away_team_id, status, source)
select v.id, 'window-test', 1, now() + v.at, t[v.h], t[v.a], 'SCHEDULED', 'test'
from t_teams, (values
  ('cw-near', interval '13 days', 1, 2),
  ('cw-far', interval '15 days', 3, 4),
  ('cw-old', interval '20 days', 1, 4)
) as v(id, at, h, a);
insert into public.entries (season, team_name, user_id)
values ('window-test', 'Window Test XV', '00000000-0000-0000-0000-00000000000a');
-- A call made before the rule existed (owner SQL, so allowed).
insert into public.predictions (entry_id, match_id, home_score, away_score)
select id, 'cw-old', 20, 10 from public.entries where season = 'window-test';
grant select on t_teams to authenticated;

select set_config('role', 'authenticated', false), set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into public.predictions (entry_id, match_id, home_score, away_score)
select id, 'cw-near', 24, 17 from public.entries where season = 'window-test';
do $$ begin
  insert into public.predictions (entry_id, match_id, home_score, away_score)
  select id, 'cw-far', 24, 17 from public.entries where season = 'window-test';
  raise exception 'FAILED: a call 15 days out went in';
exception when sqlstate 'P0001' then raise notice 'ok: a call 15 days out is refused';
end $$;
do $$ begin
  update public.predictions set home_score = 30 where match_id = 'cw-old';
  raise exception 'FAILED: an early call was changed 20 days out';
exception when sqlstate 'P0001' then raise notice 'ok: an early call can''t be changed until the window opens';
end $$;
update public.predictions set is_banker = true where match_id = 'cw-old';
reset role;
select set_config('request.jwt.claim.sub', '', false);

select pg_temp.check(exists (select 1 from public.predictions where match_id = 'cw-near'), 'a call 13 days out goes in');
select pg_temp.check((select home_score from public.predictions where match_id = 'cw-old') = 20, 'a call made before the rule is kept');
select pg_temp.check((select is_banker from public.predictions where match_id = 'cw-old'), 'the Banker can still move');
select pg_temp.check(public.call_window_days() = 14, 'the window is 14 days');

do $$ begin raise notice 'CALL WINDOW CHECKS PASSED'; end $$;
