-- Class years on the school page and Leagues, and the moments worth a share picture.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  if uid is null then perform set_config('role', 'anon', false); perform set_config('request.jwt.claim.sub', '', false);
  else perform set_config('role', 'authenticated', false); perform set_config('request.jwt.claim.sub', uid::text, false); end if;
end $$;

-- A live tournament and a high school with three classes: 2007 (three players), 2008 (three) and 2009 (one).
insert into public.seasons (id, name, is_replay, competition_id, feed_season)
select 'cs-test', 'Class Cup', false, competition_id, 'cs' from public.seasons limit 1;
insert into public.schools (emis, name, town, province, no_fee, offers_primary, offers_matric, source)
values ('209990001', 'Class Test High School', 'Gqeberha', 'EC', false, false, true, 'test');
create temp table u as
  select user_id, row_number() over (order by user_id) as n
  from public.members m
  where not exists (select 1 from public.member_schools ms where ms.user_id = m.user_id and ms.stage = 'high')
  order by user_id limit 7;
grant select on u to authenticated, anon;
select pg_temp.check((select count(*) from u) = 7, 'seven players without a high school to test with');
insert into public.member_schools (user_id, stage, emis, last_year)
select user_id, 'high', '209990001', case when n <= 3 then 2007 when n <= 6 then 2008 else 2009 end from u;
insert into public.entries (user_id, season, team_name) select user_id, 'cs-test', 'CS ' || n from u
on conflict (user_id, season) do nothing;

-- A mates' league of players 1, 2, 4 and 5.
insert into public.pools (season, name, created_by) select 'cs-test', 'CS Mates', user_id from u where n = 1;
insert into public.pool_members (pool_id, user_id)
select p.id, u.user_id from public.pools p, u where p.name = 'CS Mates' and u.n in (1, 2, 4, 5) on conflict do nothing;

-- One game, the whole of round 1, finished two hours ago: 24-20. Player 1 calls it exactly;
-- in the mates' league only player 1 backs the home side. Player 6 backs it too, outside the league.
insert into public.matches (id, season, round, kickoff_at, home_team_id, away_team_id, status, source)
select 'cs1', 'cs-test', 1, now() - interval '2 hours', (select id from public.teams order by id limit 1),
       (select id from public.teams order by id offset 1 limit 1), 'SCHEDULED', 'test';
set session_replication_role = replica;
insert into public.predictions (entry_id, match_id, home_score, away_score)
select e.id, 'cs1', x.h, x.a from u join public.entries e on e.user_id = u.user_id and e.season = 'cs-test'
join (values (1, 24, 20), (2, 10, 30), (3, 10, 30), (4, 20, 24), (5, 10, 12), (6, 20, 15), (7, 12, 13)) as x(n, h, a) on x.n = u.n;
set session_replication_role = origin;
update public.matches set home_score = 24, away_score = 20, status = 'FT' where id = 'cs1';

-- The school page: any player sees the school's class years.
select pg_temp.as_user((select user_id from u where n = 1));
select pg_temp.check((select count(*) from public.school_classes_at('209990001', 'high', 'cs-test')) = 3, 'the school page lists each class year');
select pg_temp.check((select average is not null and mine from public.school_classes_at('209990001', 'high', 'cs-test') where school_year = 2007),
                     'a class of three is ranked, marked as yours');
select pg_temp.check((select average is null and players = 1 from public.school_classes_at('209990001', 'high', 'cs-test') where school_year = 2009),
                     'a class of one is not ranked yet');
select pg_temp.check((select place = 1 and ranked = 2 and players = 3 from public.my_class_places('cs-test') where emis = '209990001'),
                     'Leagues: your class is 1st of 2 ranked');
reset role;
select pg_temp.as_user((select user_id from u where n = 7));
select pg_temp.check((select place is null and players = 1 from public.my_class_places('cs-test') where emis = '209990001'),
                     'a class still short of players shows how many are playing');
select pg_temp.check(public.my_share_moments() -> 'class_lead' = 'null'::jsonb, 'no class-lead picture for a class that is not ranked');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ff');
select pg_temp.check((select count(*) from public.school_classes_at('209990001', 'high', 'cs-test')) = 0, 'someone uninvited sees no classes');
reset role;
select pg_temp.check(not has_function_privilege('anon', 'public.my_share_moments()', 'execute')
                     and not has_function_privilege('anon', 'public.school_classes_at(text, text, text)', 'execute'),
                     'signed-out visitors can''t ask at all');

-- Share moments for player 1: spot on (1 of 7), the only one in the mates' league to back the winner,
-- top of the league for the round, and the class leads the school.
select pg_temp.as_user((select user_id from u where n = 1));
create temp table sm as select public.my_share_moments() as j;
select pg_temp.check((select (j -> 'exact' -> 0 ->> 'same')::int = 1 and (j -> 'exact' -> 0 ->> 'callers')::int = 7 from sm),
                     'an exact call, with how many of everyone got it');
select pg_temp.check((select j -> 'lone' -> 0 ->> 'league' = 'CS Mates' and (j -> 'lone' -> 0 ->> 'callers')::int = 4 from sm),
                     'the only one in a league who backed the winner');
select pg_temp.check((select j -> 'round_top' ->> 'league' = 'Class Test High School' and (j -> 'round_top' ->> 'callers')::int = 7
                             and not (j -> 'round_top' ->> 'joint')::boolean from sm),
                     'top of the round in the biggest league you lead (here the whole school''s)');
select pg_temp.check((select j -> 'class_lead' ->> 'school' = 'Class Test High School' and (j -> 'class_lead' ->> 'school_year')::int = 2007 from sm),
                     'and the class leading the school');
select pg_temp.check((select j::text not like '%CS 2%' and j::text not like '%display_name%' from sm), 'nobody else is named');
reset role;

-- Player 2: nothing of their own to brag about except the class.
select pg_temp.as_user((select user_id from u where n = 2));
select pg_temp.check((select jsonb_array_length(j -> 'exact') = 0 and jsonb_array_length(j -> 'lone') = 0 and j -> 'round_top' = 'null'::jsonb
                      from (select public.my_share_moments() as j) x), 'a player who missed gets no call pictures');
reset role;

-- A round that hasn't finished: no round or class picture yet.
insert into public.matches (id, season, round, kickoff_at, home_team_id, away_team_id, status, source)
select 'cs2', 'cs-test', 1, now() + interval '1 day', (select id from public.teams order by id limit 1),
       (select id from public.teams order by id offset 1 limit 1), 'SCHEDULED', 'test';
select pg_temp.as_user((select user_id from u where n = 1));
select pg_temp.check((select j -> 'round_top' = 'null'::jsonb and j -> 'class_lead' = 'null'::jsonb and jsonb_array_length(j -> 'exact') = 1
                      from (select public.my_share_moments() as j) x), 'round and class pictures wait for the round to finish');
reset role;

do $$ begin raise notice 'CLASS AND SHARE CHECKS PASSED'; end $$;
