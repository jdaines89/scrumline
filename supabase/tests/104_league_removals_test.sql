-- Whoever started a league can remove a player, who then can't come back in.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  if uid is null then perform set_config('role', 'anon', false); perform set_config('request.jwt.claim.sub', '', false);
  else perform set_config('role', 'authenticated', false); perform set_config('request.jwt.claim.sub', uid::text, false); end if;
end $$;
create function pg_temp.fails(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;

-- Three non-admin players: a starts the league, b and c join it.
create temp table r as
select (select user_id from public.members where not is_admin order by user_id limit 1) as a,
       (select user_id from public.members where not is_admin order by user_id offset 1 limit 1) as b,
       (select user_id from public.members where not is_admin order by user_id offset 2 limit 1) as c,
       (select user_id from public.members where is_admin order by user_id limit 1) as admin;
insert into public.pools (season, name, created_by) select 'urc-2026-27', 'Removal test league', a from r;
alter table r add column league bigint, add column other bigint;
update r set league = (select id from public.pools where name = 'Removal test league' and league_id = id);
update r set other = (select id from public.pools where league_id = r.league and id <> r.league order by id limit 1);
alter table r add column code text;
update r set code = (select join_code from public.pools where id = r.league);
grant select on r to authenticated, anon;
select pg_temp.check((select other is not null from r), 'the league has a second tournament''s table');

select pg_temp.as_user((select b from r));
select public.join_pool((select code from r));
select pg_temp.as_user((select c from r));
select public.join_pool((select code from r));
reset role;
select pg_temp.check((select count(*) from public.pool_members where user_id = (select b from r)
                      and pool_id in (select id from public.pools where league_id = (select league from r))) >= 2,
                     'b is in every table of the league');

-- A player who didn't start it can't remove anyone, or change its code.
select pg_temp.as_user((select c from r));
select pg_temp.check(pg_temp.fails($$select public.remove_league_member((select league from r), (select b from r))$$), 'a player can''t remove another');
select pg_temp.check(pg_temp.fails($$select public.new_league_code((select league from r))$$), 'or change the league code');
select pg_temp.check(not exists (select 1 from public.league_removed((select league from r))), 'or see who was removed');
select pg_temp.check(pg_temp.fails($$select * from public.league_removals$$), 'and the removals table is closed to players');
reset role;

-- Whoever started it removes b, from any tournament's table.
create temp table calls_before as select count(*) n from public.predictions p join public.entries e on e.id = p.entry_id where e.user_id = (select b from r);
select pg_temp.as_user((select a from r));
select pg_temp.check(pg_temp.fails($$select public.remove_league_member((select league from r), (select a from r))$$), 'you can''t remove yourself');
select public.remove_league_member((select other from r), (select b from r));
select pg_temp.check((select count(*) from public.league_removed((select league from r))) = 1, 'the starter sees b on the removed list');
reset role;
select pg_temp.check(not exists (select 1 from public.pool_members where user_id = (select b from r)
                      and pool_id in (select id from public.pools where league_id = (select league from r))),
                     'b is out of every table in the league');
select pg_temp.check((select count(*) from public.predictions p join public.entries e on e.id = p.entry_id where e.user_id = (select b from r))
                     = (select n from calls_before), 'b keeps every call');
select pg_temp.check(exists (select 1 from public.pool_members where user_id = (select c from r)
                      and pool_id = (select league from r)), 'c is still in');

-- b can't get back in by code, invite link or league invite.
select pg_temp.as_user((select b from r));
select pg_temp.check(pg_temp.fails($$select public.join_pool((select code from r))$$), 'b can''t rejoin by code');
reset role;
insert into public.pool_members (pool_id, user_id) select other, b from r;
select pg_temp.check(not exists (select 1 from public.pool_members where user_id = (select b from r)
                      and pool_id in (select id from public.pools where league_id = (select league from r))),
                     'any other way in is quietly refused');

-- A new code: the old one stops working, every table changes.
create temp table old_codes as select id, join_code from public.pools where league_id = (select league from r);
grant select on old_codes to authenticated;
select pg_temp.as_user((select a from r));
select pg_temp.check(public.new_league_code((select league from r)) <> (select code from r), 'the starter gets a new code');
reset role;
select pg_temp.check(not exists (select 1 from public.pools p join old_codes o on o.id = p.id where p.join_code = o.join_code), 'every table in the league has a new code');
update r set code = (select join_code from public.pools where id = r.league);
select pg_temp.as_user((select c from r));
select pg_temp.check(pg_temp.fails($$select public.join_pool((select join_code from old_codes limit 1))$$), 'the old code no longer joins');
reset role;

-- The starter lets b back in; b can join again by code.
select pg_temp.as_user((select a from r));
select public.league_let_back((select league from r), (select b from r));
select pg_temp.as_user((select b from r));
select public.join_pool((select code from r));
reset role;
select pg_temp.check(exists (select 1 from public.pool_members where user_id = (select b from r) and pool_id = (select other from r)), 'once let back, b can rejoin');

-- An admin can remove from any league, but nobody can remove whoever started it.
select pg_temp.as_user((select admin from r));
select public.remove_league_member((select league from r), (select c from r));
select pg_temp.check(pg_temp.fails($$select public.remove_league_member((select league from r), (select a from r))$$), 'the starter can''t be removed');
reset role;
select pg_temp.check(not exists (select 1 from public.pool_members where user_id = (select c from r) and pool_id = (select league from r)), 'an admin removed c');

-- School leagues aren't run this way.
select pg_temp.as_user((select admin from r));
select pg_temp.check(pg_temp.fails($$select public.remove_league_member((select id from public.pools where school_emis is not null limit 1), (select c from r))$$),
                     'nobody removes players from a school league');
reset role;

do $$ begin raise notice 'LEAGUE REMOVAL CHECKS PASSED'; end $$;
