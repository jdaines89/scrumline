-- Everyone in a tournament: your place among all its players, by team name only.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  if uid is null then perform set_config('role', 'anon', false); perform set_config('request.jwt.claim.sub', '', false);
  else perform set_config('role', 'authenticated', false); perform set_config('request.jwt.claim.sub', uid::text, false); end if;
end $$;
create function pg_temp.fails(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;

insert into public.seasons (id, name, is_replay, competition_id, feed_season, starts_on)
values ('everyone-test', 'Everyone Test Cup', false, 'varsity-cup', 'everyone-test', current_date - 30);
create temp table t_teams as select array_agg(id order by id) as t from (select id from public.teams order by id limit 2) x;
insert into public.matches (id, season, round, kickoff_at, home_team_id, away_team_id, status, source)
select 'ev-' || r, 'everyone-test', r, now() - (10 - r) * interval '1 day', t[1], t[2], 'SCHEDULED', 'test'
from t_teams, generate_series(1, 3) r;

-- Eight players with 80, 70, ... 10 points; the 10-point one hasn't called the last two rounds.
create temp table r as
select user_id, row_number() over (order by user_id) as n
from (select user_id from public.members order by user_id limit 8) x;
grant select on r to authenticated, anon;
insert into public.entries (user_id, season, team_name, created_at)
select user_id, 'everyone-test', 'Everyone team ' || n, now() - interval '20 days' from r;
-- Past games are locked to players, so the calls go in as if made before kickoff.
set session_replication_role = replica;
insert into public.predictions (entry_id, match_id, home_score, away_score)
select e.id, 'ev-' || m, 20, 10
from public.entries e join r on r.user_id = e.user_id, generate_series(1, 3) m
where e.season = 'everyone-test' and (r.n < 8 or m = 1);
set session_replication_role = origin;
insert into public.entry_round_totals (entry_id, season, round, total_pts)
select e.id, 'everyone-test', 1, 90 - 10 * r.n
from public.entries e join r on r.user_id = e.user_id where e.season = 'everyone-test'
on conflict (entry_id, round) do update set total_pts = excluded.total_pts;

select pg_temp.as_user((select user_id from r where n = 6));
create temp table t_six as select * from public.everyone_table('everyone-test');
reset role;
select pg_temp.check((select players from t_six limit 1) = 7 and (select resting_players from t_six limit 1) = 1,
                     'counts everyone playing, and those taking a break apart');
select pg_temp.check((select place from t_six where mine) = 6, 'your place among everyone');
select pg_temp.check((select array_agg(place order by place) from t_six) = array[1, 2, 3, 4, 5, 6, 7],
                     'the top three and the two either side of you');
select pg_temp.check((select points from t_six where place = 1) = 80, 'with their points');

select pg_temp.as_user((select user_id from r where n = 8));
create temp table t_eight as select * from public.everyone_table('everyone-test');
reset role;
select pg_temp.check((select place is null and points = 10 from t_eight where mine), 'on a break you see your points, unranked');
select pg_temp.check((select count(*) from t_eight) = 4, 'and just the top three besides');

select pg_temp.as_user(null);
select pg_temp.check(pg_temp.fails($$select * from public.everyone_table('everyone-test')$$), 'signed-out visitors can''t read it');
reset role;

do $$ begin raise notice 'EVERYONE TABLE CHECKS PASSED'; end $$;
