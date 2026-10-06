-- Call before you join: an invite link shows the next round's games.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;

insert into public.seasons (id, name, is_replay, competition_id, feed_season, starts_on)
values ('invite-test', 'Invite Test Cup', false, 'varsity-cup', 'invite-test', current_date - 7);
create temp table t_teams as select array_agg(id order by id) as t from (select id from public.teams order by id limit 4) x;
insert into public.matches (id, season, round, kickoff_at, home_team_id, away_team_id, home_score, away_score, status, source)
select v.id, 'invite-test', v.round, now() + v.at, t[v.h], t[v.a], v.hs, v.as_, v.st, 'test'
from t_teams, (values
  ('it-1', 1, interval '-3 days', 1, 2, 20, 10, 'FT'),
  ('it-2', 2, interval '-1 hour', 3, 4, null, null, 'SCHEDULED'),
  ('it-3', 2, interval '2 days', 1, 3, null, null, 'SCHEDULED'),
  ('it-4', 2, interval '1 day', 2, 4, null, null, 'SCHEDULED'),
  ('it-5', 3, interval '9 days', 1, 4, null, null, 'SCHEDULED')
) as v(id, round, at, h, a, hs, as_, st);
insert into public.pools (season, name, created_by, join_code)
select 'invite-test', 'Invite test league', (select user_id from public.members order by user_id limit 1), 'INVTEST';

set role anon;
create temp table t_r as select * from public.invite_round('invtest');
reset role;

select pg_temp.check((select count(*) from t_r) = 2, 'a league link shows the next round''s games that haven''t kicked off');
select pg_temp.check((select array_agg(match_id order by kickoff_at) from t_r) = array['it-4', 'it-3'], 'in kick-off order');
select pg_temp.check((select bool_and(round = 2 and season_id = 'invite-test' and home_name is not null and away_short is not null) from t_r),
                     'with the round, the tournament and both teams');
select pg_temp.check(not exists (select 1 from public.invite_round('no-such-code') where season_id = 'invite-test' and match_id = 'it-2'),
                     'a game that has kicked off never shows');

do $$ begin raise notice 'INVITE ROUND CHECKS PASSED'; end $$;
