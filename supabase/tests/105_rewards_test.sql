-- Sponsor rewards: unlocking is checked on the server, codes go out once each, players never read the codes table.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  if uid is null then perform set_config('role', 'anon', false); perform set_config('request.jwt.claim.sub', '', false);
  else perform set_config('role', 'authenticated', false); perform set_config('request.jwt.claim.sub', uid::text, false); end if;
end $$;
create function pg_temp.fails(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;

insert into public.seasons (id, name, is_replay, competition_id, feed_season)
select 'rw-test', 'Reward Cup', false, competition_id, 'rw' from public.seasons limit 1;
create temp table u as
  select user_id, row_number() over (order by user_id) as n from public.members where not is_admin order by user_id limit 3;
create temp table adm as select user_id from public.members where is_admin order by user_id limit 1;
grant select on u, adm to authenticated, anon;
select pg_temp.check((select count(*) from u) = 3 and (select count(*) from adm) = 1, 'two players and an admin to test with');
insert into public.entries (user_id, season, team_name) select user_id, 'rw-test', 'RW ' || n from u on conflict (user_id, season) do nothing;

-- Three rounds of two games each (teams from the seed).
insert into public.matches (id, season, round, kickoff_at, home_team_id, away_team_id, home_score, away_score, status, source)
select 'rw-' || r || '-' || g, 'rw-test', r, now() - interval '30 days' + (r * interval '1 day'),
       (select id from public.teams order by id limit 1), (select id from public.teams order by id offset 1 limit 1), 20, 10, 'FT', 'test'
from generate_series(1, 3) r, generate_series(1, 2) g;

-- Player 1: an exact score in each of the three rounds, the Banker exact in round 3, both winners right in round 1.
insert into public.prediction_points (entry_id, match_id, season, round, pred_home, pred_away, real_home, real_away, right_result,
                                      result_pts, margin_pts, near_pts, exact_pts, total_pts, is_banker)
select e.id, 'rw-' || x.r || '-' || x.g, 'rw-test', x.r, 20, 10, 20, 10, true, 6, 5, 4, case when x.g = 1 then 5 else 0 end, 20, (x.r = 3 and x.g = 1)
from public.entries e, (select r, g from generate_series(1, 3) r, generate_series(1, 2) g) x
where e.season = 'rw-test' and e.user_id = (select user_id from u where n = 1);
-- Player 2: only one exact score and a wrong winner.
insert into public.prediction_points (entry_id, match_id, season, round, pred_home, pred_away, real_home, real_away, right_result,
                                      result_pts, margin_pts, near_pts, exact_pts, total_pts, is_banker)
select e.id, 'rw-1-1', 'rw-test', 1, 20, 10, 20, 10, true, 6, 5, 4, 5, 20, false from public.entries e
where e.season = 'rw-test' and e.user_id = (select user_id from u where n = 2);
insert into public.prediction_points (entry_id, match_id, season, round, pred_home, pred_away, real_home, real_away, right_result,
                                      result_pts, margin_pts, near_pts, exact_pts, total_pts, is_banker)
select e.id, 'rw-1-2', 'rw-test', 1, 5, 30, 20, 10, false, 0, 0, 0, 0, 0, false from public.entries e
where e.season = 'rw-test' and e.user_id = (select user_id from u where n = 2);

select pg_temp.check(public.achievement_earned((select id from public.entries where user_id = (select user_id from u where n = 1) and season = 'rw-test'), 'rw-test', 'sharpshooter'), 'player 1 has 3 exact scores in 3 rounds');
select pg_temp.check(public.achievement_earned((select id from public.entries where user_id = (select user_id from u where n = 1) and season = 'rw-test'), 'rw-test', 'banker-bang'), 'and an exact Banker');
select pg_temp.check(public.achievement_earned((select id from public.entries where user_id = (select user_id from u where n = 1) and season = 'rw-test'), 'rw-test', 'clean-sweep'), 'and a clean sweep');
select pg_temp.check(not public.achievement_earned((select id from public.entries where user_id = (select user_id from u where n = 1) and season = 'rw-test'), 'rw-test', 'dead-on'), 'but not dead-on (two games a round)');
select pg_temp.check(not public.achievement_earned((select id from public.entries where user_id = (select user_id from u where n = 2) and season = 'rw-test'), 'rw-test', 'sharpshooter'), 'player 2 has not');
select pg_temp.check(not public.achievement_earned((select id from public.entries where user_id = (select user_id from u where n = 2) and season = 'rw-test'), 'rw-test', 'clean-sweep'), 'and a wrong winner spoils the sweep');

-- Only an admin makes campaigns and adds codes.
select pg_temp.as_user((select user_id from u where n = 1));
select pg_temp.check(pg_temp.fails($$select public.admin_save_reward(null, 'rw-test', 'R100 voucher', null, 'sharpshooter', null, null, null, true)$$), 'a player can''t create a campaign');
select pg_temp.check(pg_temp.fails($$select * from public.reward_codes$$), 'a player can''t read the codes table');
select pg_temp.as_user((select user_id from adm));
create temp table camp as select public.admin_save_reward(null, 'rw-test', 'R100 voucher', 'Test sponsor', 'sharpshooter', null, null, null, true) as id;
grant select on camp to authenticated, anon;
select pg_temp.check((select public.admin_add_reward_codes((select id from camp), E'AAA111\nBBB222, AAA111\n  ')) = 2, 'two codes added, repeats ignored');
select pg_temp.check((select remaining from public.admin_rewards() where id = (select id from camp)) = 2, 'admin sees counts');

-- Player 2 hasn't unlocked it; player 1 has, and gets one code, the same one again if they ask twice.
select pg_temp.as_user((select user_id from u where n = 2));
select pg_temp.check(pg_temp.fails($$select public.claim_reward((select id from camp))$$), 'can''t claim before unlocking');
select pg_temp.check((select not earned and not claimed and code is null from public.my_rewards('rw-test')), 'my_rewards shows it locked with no code');
select pg_temp.as_user((select user_id from u where n = 1));
create temp table got as select public.claim_reward((select id from camp)) as code;
grant select on got to authenticated;
select pg_temp.check((select code in ('AAA111', 'BBB222') from got), 'player 1 gets a code');
select pg_temp.check(public.claim_reward((select id from camp)) = (select code from got), 'asking again returns the same code');
select pg_temp.check((select claimed and code = (select code from got) and remaining = 1 from public.my_rewards('rw-test')), 'my_rewards shows my own code and what is left');
select pg_temp.as_user((select user_id from u where n = 2));
select pg_temp.check((select code is null from public.my_rewards('rw-test')), 'nobody else sees that code');
reset role;
select pg_temp.check((select count(*) from public.reward_codes where claimed_by is not null) = 1, 'one code is out');

-- Switched off: nothing shows and nothing can be claimed.
update public.reward_campaigns set active = false where id = (select id from camp);
select pg_temp.as_user((select user_id from u where n = 1));
select pg_temp.check(not exists (select 1 from public.my_rewards('rw-test')), 'an inactive campaign is invisible');
select pg_temp.check(pg_temp.fails($$select public.claim_reward((select id from camp))$$), 'and can''t be claimed');
reset role;
select 'REWARDS CHECKS PASSED';
