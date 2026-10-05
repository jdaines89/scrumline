-- Round opener: who gets the day-before nudge. Runs after the other tests.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;

insert into public.seasons (id, name, is_replay, competition_id, feed_season)
select 'zz-test', 'Test Cup', false, competition_id, 'zz' from public.seasons limit 1;
create temp table t as
  select (select id from public.teams order by id limit 1) as home, (select id from public.teams order by id offset 1 limit 1) as away,
         (select user_id from public.members where email_reminders order by user_id limit 1) as fresh,
         (select user_id from public.members where email_reminders order by user_id offset 1 limit 1) as regular;
insert into public.entries (user_id, season, team_name, created_at)
select u, 'zz-test', 'ZZ ' || left(u::text, 8), now() - interval '10 days' from t, unnest(array[t.fresh, t.regular]) u
on conflict (user_id, season) do update set created_at = excluded.created_at;
insert into public.matches (id, season, round, kickoff_at, home_team_id, away_team_id, status, source)
select 'zz1', 'zz-test', 1, now() - interval '6 days', home, away, 'FT', 'test' from t union all
select 'zz2', 'zz-test', 2, now() + interval '24 hours', home, away, 'SCHEDULED', 'test' from t union all
select 'zz3', 'zz-test', 3, now() + interval '8 days', home, away, 'SCHEDULED', 'test' from t;
-- The regular called round 1 (before it locked); the other player missed it.
set session_replication_role = replica;
insert into public.predictions (entry_id, match_id, home_score, away_score)
select e.id, 'zz1', 20, 10 from public.entries e, t where e.season = 'zz-test' and e.user_id = t.regular;
set session_replication_role = origin;

select pg_temp.check((select count(*) from notify.due_round_openers() d, t where d.season = 'zz-test' and d.round = 2
                      and d.user_id in (t.fresh, t.regular)) = 2
                     and not exists (select 1 from notify.due_round_openers() d join public.members m using (user_id) where not m.email_reminders),
                     'players with reminders on are due a nudge for the round starting tomorrow');
select pg_temp.check(not exists (select 1 from notify.due_round_openers() d where d.season = 'zz-test' and d.round = 3),
                     'a round a week away waits');
select pg_temp.check((select missed_last from notify.due_round_openers() d, t where d.season = 'zz-test' and d.user_id = t.fresh),
                     'a player who missed last round gets the fresh-start message');
select pg_temp.check(not (select missed_last from notify.due_round_openers() d, t where d.season = 'zz-test' and d.user_id = t.regular),
                     'a regular gets the normal message');

-- Calling one game of the round, or being nudged already, takes you off the list.
insert into public.predictions (entry_id, match_id, home_score, away_score)
select e.id, 'zz2', 15, 12 from public.entries e, t where e.season = 'zz-test' and e.user_id = t.regular;
insert into notify.round_nudges (user_id, season, round, channel) select fresh, 'zz-test', 2, 'email' from t;
select pg_temp.check(not exists (select 1 from notify.due_round_openers() d, t where d.season = 'zz-test' and d.user_id in (t.fresh, t.regular)),
                     'nobody is nudged twice, or after calling');

do $$ begin raise notice 'OPENER CHECKS PASSED'; end $$;
