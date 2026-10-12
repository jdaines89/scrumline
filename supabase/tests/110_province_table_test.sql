-- Provinces: the average of each province's best schools, high and primary apart.
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
  ('209990101', 'Province Test High A', 'Gqeberha', 'EC', false, false, true, 'test'),
  ('209990102', 'Province Test High B', 'Makhanda', 'EC', false, false, true, 'test'),
  ('109990103', 'Province Test High C', 'Paarl', 'WC', false, false, true, 'test'),
  ('209990104', 'Province Test Primary', 'Gqeberha', 'EC', false, true, false, 'test');
-- Players 1-2 at EC high A (30, 10 points), 3 at EC high B (20), 4 at WC high C (25), 5 at the EC primary (40).
create temp table u as
  select user_id, row_number() over (order by user_id) as n
  from public.members m
  where not exists (select 1 from public.member_schools ms where ms.user_id = m.user_id)
  order by user_id limit 5;
grant select on u to authenticated, anon;
select pg_temp.check((select count(*) from u) = 5, 'five players without a school to test with');
insert into public.member_schools (user_id, stage, emis, last_year)
select user_id, case when n = 5 then 'primary' else 'high' end,
       (array['209990101', '209990101', '209990102', '109990103', '209990104'])[n], 2010 from u;
insert into public.entries (user_id, season, team_name) select user_id, 'pv-test', 'PV ' || n from u
on conflict (user_id, season) do nothing;
insert into public.entry_round_totals (entry_id, season, round, total_pts, matches)
select e.id, 'pv-test', 1, (array[30, 10, 20, 25, 40])[u.n], 1
from u join public.entries e on e.user_id = u.user_id and e.season = 'pv-test'
on conflict (entry_id, round) do update set total_pts = excluded.total_pts, matches = excluded.matches;

create or replace function public.school_rules_relaxed() returns boolean language sql immutable as $$ select true $$;
select pg_temp.as_user((select user_id from u where n = 1));
create temp table t as select jsonb_array_elements(public.province_table('pv-test', 'high')) as p;
create temp table tp as select jsonb_array_elements(public.province_table('pv-test', 'primary')) as p;
reset role;
select pg_temp.check((select count(*) from t) = 2, 'only provinces with a ranked high school');
-- EC: high A averages (30+10)/2 = 20, high B 20; the province averages its schools = 20.
select pg_temp.check((select (p->>'score')::numeric = 20 and (p->>'schools')::int = 2 and (p->>'mine')::boolean from t where p->>'province' = 'EC'),
                     'a province scores the average of its schools');
select pg_temp.check((select (p->>'score')::numeric = 25 and (p->>'schools')::int = 1 from t where p->>'province' = 'WC'),
                     'a smaller province can top a bigger one');
select pg_temp.check((select jsonb_array_length(p->'top') = 2 and p->'top'->0->>'name' like 'Province Test High %' from t where p->>'province' = 'EC'),
                     'with its top schools');
select pg_temp.check((select count(*) = 1 and bool_and((p->>'score')::numeric = 40) from tp), 'primary schools rank apart from high schools');

select pg_temp.as_user(null);
do $$ begin
  perform public.province_table('pv-test', 'high');
  raise exception 'FAILED: a signed-out visitor read the provinces';
exception when insufficient_privilege then raise notice 'ok: signed-out visitors can''t read it';
end $$;
reset role;
create or replace function public.school_rules_relaxed() returns boolean language sql immutable as $$ select false $$;

do $$ begin raise notice 'PROVINCE TABLE CHECKS PASSED'; end $$;
