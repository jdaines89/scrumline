-- Match moments: the kickoff reveal in league chat, and the full-time push and Home card.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  if uid is null then perform set_config('role', 'anon', false); perform set_config('request.jwt.claim.sub', '', false);
  else perform set_config('role', 'authenticated', false); perform set_config('request.jwt.claim.sub', uid::text, false); end if;
end $$;

-- A live test tournament, a mates' league of three, and a player outside it.
insert into public.seasons (id, name, is_replay, competition_id, feed_season)
select 'mm-test', 'Moments Cup', false, competition_id, 'mm' from public.seasons limit 1;
create temp table t as
  select (select id from public.teams order by id limit 1) as home, (select id from public.teams order by id offset 1 limit 1) as away,
         (select user_id from public.members order by user_id limit 1) as a,
         (select user_id from public.members order by user_id offset 1 limit 1) as b,
         (select user_id from public.members order by user_id offset 2 limit 1) as c,
         (select user_id from public.members order by user_id offset 3 limit 1) as outsider;
grant select on t to authenticated, anon;
insert into public.entries (user_id, season, team_name)
select u, 'mm-test', 'MM ' || left(u::text, 8) from t, unnest(array[t.a, t.b, t.c]) u
on conflict (user_id, season) do nothing;
insert into public.pools (season, name, created_by) select 'mm-test', 'Moments Mates', a from t;
create temp table tp as select id as pool from public.pools where season = 'mm-test' and name = 'Moments Mates';
grant select on tp to authenticated, anon;
insert into public.pool_members (pool_id, user_id, joined_at, history_from)
select tp.pool, u, now() - interval '30 days', now() - interval '30 days' from tp, t, unnest(array[t.a, t.b, t.c]) u
on conflict do nothing;

-- Last week's game (b called it better), today's game that just kicked off, and one still to come.
insert into public.matches (id, season, round, kickoff_at, home_team_id, away_team_id, status, source)
select 'mm0', 'mm-test', 1, now() - interval '7 days', home, away, 'SCHEDULED', 'test' from t union all
select 'mm1', 'mm-test', 2, now() - interval '30 minutes', home, away, 'SCHEDULED', 'test' from t union all
select 'mm2', 'mm-test', 2, now() + interval '2 hours', home, away, 'SCHEDULED', 'test' from t;
set session_replication_role = replica;
insert into public.predictions (entry_id, match_id, home_score, away_score)
select e.id, x.m, x.h, x.aw from public.entries e join t on true
join (values ('a', 'mm0', 10, 30), ('b', 'mm0', 20, 15), ('a', 'mm1', 24, 20), ('b', 'mm1', 10, 30), ('a', 'mm2', 20, 10), ('b', 'mm2', 25, 10))
  as x(who, m, h, aw) on e.user_id = case x.who when 'a' then t.a else t.b end
where e.season = 'mm-test';
set session_replication_role = origin;
update public.matches set home_score = 20, away_score = 17, status = 'FT' where id = 'mm0';

-- Kickoff: the league's chat gets one reveal for the game that started, none for the one to come.
select public.post_match_reveals();
select pg_temp.check((select count(*) from public.match_reveals r, tp where r.pool_id = tp.pool and r.match_id = 'mm1') = 1,
                     'a game that just kicked off is revealed in the league chat');
select pg_temp.check(not exists (select 1 from public.match_reveals where match_id in ('mm0', 'mm2')),
                     'old games and games still to come are not');
select pg_temp.check(public.post_match_reveals() = 0, 'and nothing is revealed twice');

select pg_temp.as_user((select a from t));
select pg_temp.check(exists (select 1 from public.match_reveals r, tp where r.pool_id = tp.pool), 'league players see the reveal');
reset role;
select pg_temp.as_user((select outsider from t));
select pg_temp.check(not exists (select 1 from public.match_reveals r, tp where r.pool_id = tp.pool), 'someone outside the league does not');
reset role;

-- A league where only one player called the game gets no reveal.
insert into public.pools (season, name, created_by) select 'mm-test', 'Lonely Mates', a from t;
insert into public.pool_members (pool_id, user_id) select p.id, u from public.pools p, t, unnest(array[t.a, t.c]) u where p.name = 'Lonely Mates' on conflict do nothing;
select public.post_match_reveals();
select pg_temp.check(not exists (select 1 from public.match_reveals r join public.pools p on p.id = r.pool_id where p.name = 'Lonely Mates'),
                     'a game only one league player called is not revealed there');

-- Full time: a called it exactly and passes b.
update public.matches set home_score = 24, away_score = 20, status = 'FT' where id = 'mm1';
create temp table ft as select public.full_time_moment((select a from t), now() - interval '12 hours', array['mm1']) as j;
select pg_temp.check((select (j -> 'matches' -> 0 ->> 'exact')::boolean and (j -> 'matches' -> 0 ->> 'pts')::int > 0 from ft),
                     'full time shows the exact call and its points');
select pg_temp.check((select (j -> 'league' ->> 'rank_before')::int = 2 and (j -> 'league' ->> 'rank_now')::int = 1 from ft),
                     'and the climb from 2nd to 1st in their mates'' league');
select pg_temp.check((select j -> 'league' -> 'passed' ->> 0 from ft) = (select display_name from public.members, t where user_id = t.b),
                     'naming who was passed');
select pg_temp.check((select (notify.full_time_text(j)).title from ft) like 'Full time: % 24–20 %', 'the push leads with the result');
select pg_temp.check((select (notify.full_time_text(j)).body like 'You called 24–20: +%, spot on. Up to 1st in ' || (j -> 'league' ->> 'name') || ', past %' from ft),
                     'then the call, the points and the climb');
select pg_temp.check(public.full_time_moment((select c from t), now() - interval '12 hours', array['mm1']) is null, 'nothing for a player who did not call');

-- Pushes: due once for players with push on, and not again.
insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
select 'https://push.example/' || u, u, repeat('p', 60), repeat('a', 20) from t, unnest(array[t.a, t.b]) u;
update public.members set push_results = false where user_id = (select b from t);
select pg_temp.check((select 'mm1' = any (match_ids) and not 'mm0' = any (match_ids) from notify.due_full_time() d, t where d.user_id = t.a),
                     'a player with push on is due one push for the game that just finished');
select pg_temp.check(not exists (select 1 from notify.due_full_time() d, t where d.user_id = t.b), 'not someone who switched them off');
insert into notify.settings (key, value) values ('vapid_public_key', 'test') on conflict (key) do nothing;
select notify.send_full_time();
select pg_temp.check((select count(*) from notify.push_outbox o, t where o.user_id = t.a and o.tag = 'full-time') = 1, 'the push is queued');
select pg_temp.check(not exists (select 1 from notify.due_full_time() d, t where d.user_id = t.a), 'and never sent twice');

-- Home: the signed-in player's own moment, and nobody else's.
select pg_temp.as_user((select a from t));
select pg_temp.check((public.my_full_time() -> 'matches' -> 0 ->> 'match_id') = 'mm1', 'Home shows your own full-time moment');
select pg_temp.check(not has_function_privilege('authenticated', 'public.full_time_moment(uuid, timestamptz, text[])', 'execute'),
                     'nobody can ask for someone else''s');
update public.members set push_results = false where user_id = (select a from t);
reset role;
select pg_temp.check(not (select push_results from public.members, t where user_id = t.a), 'a player can switch full-time pushes off');

do $$ begin raise notice 'MATCH MOMENT CHECKS PASSED'; end $$;
