-- A league plays every tournament: its tables spread by themselves.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;

create temp table t_who as
select (select user_id from public.members order by user_id limit 1) as a,
       (select user_id from public.members order by user_id offset 1 limit 1) as b;
create temp view t_live as
select id from public.seasons where not is_replay and (ends_on is null or ends_on >= current_date);

insert into public.pools (season, name, created_by)
select 'urc-2026-27', 'Spreading test league', a from t_who;
create temp table t_league as select id from public.pools where name = 'Spreading test league' and league_id = id;

select pg_temp.check((select count(*) from t_league) = 1, 'a new league is its own first table');
select pg_temp.check((select count(*) from public.pools where league_id = (select id from t_league)) = (select count(*) from t_live),
                     'it gets a table in every tournament that''s on or coming up');
select pg_temp.check((select count(*) from public.pool_members m join public.pools p on p.id = m.pool_id
                      where p.league_id = (select id from t_league) and m.user_id = (select a from t_who)) = (select count(*) from t_live),
                     'whoever started it is in every one');
select pg_temp.check((select count(*) from analytics.events where name = 'league_created' and pool_id in
                       (select id from public.pools where league_id = (select id from t_league))) = 1,
                     'it counts as one league started, not one per tournament');

-- Joining by any tournament's code joins them all.
insert into public.pool_members (pool_id, user_id)
select p.id, (select b from t_who) from public.pools p
where p.league_id = (select id from t_league) and p.id <> p.league_id limit 1;
select pg_temp.check((select count(*) from public.pool_members m join public.pools p on p.id = m.pool_id
                      where p.league_id = (select id from t_league) and m.user_id = (select b from t_who)) = (select count(*) from t_live),
                     'joining one tournament''s table joins the league everywhere');
select pg_temp.check((select count(*) from analytics.events where name = 'league_joined' and user_id = (select b from t_who)
                      and pool_id in (select id from public.pools where league_id = (select id from t_league))) = 1,
                     'and counts as one join');

-- A new tournament: every league gets its table, with its players.
insert into public.seasons (id, name, is_replay, competition_id, feed_season, starts_on)
values ('spread-test', 'Spreading Test Cup', false, 'varsity-cup', 'spread-test', current_date + 60);
select pg_temp.check((select count(*) from public.pool_members m join public.pools p on p.id = m.pool_id
                      where p.season = 'spread-test' and p.league_id = (select id from t_league)) = 2,
                     'a new tournament gets the league, both players in it');
select pg_temp.check(not exists (select 1 from public.pools l where l.league_id = l.id
                                 and not exists (select 1 from public.pools p where p.league_id = l.id and p.season = 'spread-test')),
                     'every league plays the new tournament');
select pg_temp.check(not exists (select 1 from public.pools where season = 'spread-test' and school_emis is null and league_id is null),
                     'and no table in it stands alone');

-- Practice replays and school leagues stay as they are.
select pg_temp.check(not exists (select 1 from public.pools p join public.seasons s on s.id = p.season
                                 where s.is_replay and p.league_id is not null), 'practice replays aren''t part of leagues');
select pg_temp.check(not exists (select 1 from public.pools where school_emis is not null and league_id is not null),
                     'school leagues aren''t either');

do $$ begin raise notice 'LEAGUE CHECKS PASSED'; end $$;
