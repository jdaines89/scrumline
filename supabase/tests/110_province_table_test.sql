-- Provinces: the average of each province's best players every round, added up.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  if uid is null then perform set_config('role', 'anon', false); perform set_config('request.jwt.claim.sub', '', false);
  else perform set_config('role', 'authenticated', false); perform set_config('request.jwt.claim.sub', uid::text, false); end if;
end $$;

insert into public.seasons (id, name, is_replay, competition_id, feed_season)
select 'pv-test', 'Province Cup', false, competition_id, 'pv' from public.seasons limit 1;
insert into public.schools (emis, name, town, province, no_fee, offers_primary, offers_matric, source) values
  ('209990101', 'Province Test High EC', 'Gqeberha', 'EC', false, false, true, 'test'),
  ('109990102', 'Province Test High WC', 'Paarl', 'WC', false, false, true, 'test'),
  ('209990103', 'Province Test Primary EC', 'Makhanda', 'EC', false, true, false, 'test');
-- Five players: 1-3 at the EC high school (30, 20, 10 points); 4 at the WC high school (25)
-- after an EC primary school, so plays for the Western Cape; 5 has no school (40).
create temp table u as
  select user_id, row_number() over (order by user_id) as n
  from public.members m
  where not exists (select 1 from public.member_schools ms where ms.user_id = m.user_id)
  order by user_id limit 5;
grant select on u to authenticated, anon;
select pg_temp.check((select count(*) from u) = 5, 'five players without a school to test with');
insert into public.member_schools (user_id, stage, emis, last_year)
select user_id, 'high', case when n <= 3 then '209990101' else '109990102' end, 2010 from u where n <= 4;
insert into public.member_schools (user_id, stage, emis, last_year)
select user_id, 'primary', '209990103', 2005 from u where n = 4;
insert into public.entries (user_id, season, team_name) select user_id, 'pv-test', 'PV ' || n from u
on conflict (user_id, season) do nothing;
insert into public.entry_round_totals (entry_id, season, round, total_pts, matches)
select e.id, 'pv-test', 1, (array[30, 20, 10, 25, 40])[u.n], 1
from u join public.entries e on e.user_id = u.user_id and e.season = 'pv-test'
on conflict (entry_id, round) do update set total_pts = excluded.total_pts, matches = excluded.matches;

create or replace function public.school_rules_relaxed() returns boolean language sql immutable as $$ select true $$;
select pg_temp.as_user((select user_id from u where n = 1));
create temp table t as select jsonb_array_elements(public.province_table('pv-test')) as p;
reset role;
select pg_temp.check((select count(*) from t) = 2, 'only provinces with players, and no one without a school');
select pg_temp.check((select (p->>'score')::numeric = 20 and (p->>'players')::int = 3 and (p->>'mine')::boolean from t where p->>'province' = 'EC'),
                     'a province scores the average of its players');
select pg_temp.check((select (p->>'score')::numeric = 25 and (p->>'players')::int = 1 from t where p->>'province' = 'WC'),
                     'a smaller province can top a bigger one, and a high school beats a primary for where you play');
select pg_temp.check((select p->'top'->0->>'team_name' = 'PV 1' and jsonb_array_length(p->'top') = 3
                             and p->'schools'->0->>'name' = 'Province Test High EC' from t where p->>'province' = 'EC'),
                     'with its top teams and schools');

-- Once the trial ends, a round needs 25 confirmed players before it counts.
create or replace function public.school_rules_relaxed() returns boolean language sql immutable as $$ select false $$;
select pg_temp.as_user((select user_id from u where n = 1));
select pg_temp.check(public.province_table('pv-test') = '[]'::jsonb, 'unconfirmed players don''t count after the trial');
select pg_temp.as_user(null);
do $$ begin
  perform public.province_table('pv-test');
  raise exception 'FAILED: a signed-out visitor read the provinces';
exception when insufficient_privilege then raise notice 'ok: signed-out visitors can''t read it';
end $$;
reset role;

do $$ begin raise notice 'PROVINCE TABLE CHECKS PASSED'; end $$;
