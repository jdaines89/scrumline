-- Class pools: your school year gets a pool of its own.
--
-- A school pool holds everyone who went to the school, which can run to
-- thousands. That's too many people for one chat, and nobody cares about
-- being 614th. So each school now has two kinds of pool per tournament:
--   * the whole-school pool (school_year null): its leaderboard, and a table
--     of class years against each other; no chat;
--   * a class pool per final year (school_year = member_schools.last_year),
--     e.g. "Victoria Park High Class of 1997": the people you actually know,
--     where the chat and weekly prizes live.
-- Membership of both follows member_schools, as before.

alter table public.pools
  add column school_year smallint check (school_year between 1940 and 2045),
  add constraint pools_year_needs_school check (school_year is null or school_emis is not null);

drop index public.pools_school;
create unique index pools_school on public.pools (season, school_emis, school_stage)
  where school_emis is not null and school_year is null;
create unique index pools_school_year on public.pools (season, school_emis, school_stage, school_year)
  where school_year is not null;

-- "Victoria Park High School Class of 1997", shortened to fit 40 characters.
create or replace function public.class_pool_name(p_school text, p_year smallint)
returns text
language sql immutable
set search_path = public
as $$
  select case when length(p_school) <= 26 then p_school
              else rtrim(left(p_school, 25)) || '…' end || ' Class of ' || p_year
$$;

create or replace function public.sync_school_pools(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Leave any school or class pool that no longer matches a saved school.
  delete from public.pool_members pm
  using public.pools p
  where pm.pool_id = p.id and pm.user_id = p_user and p.school_emis is not null
    and not exists (select 1 from public.member_schools ms
                    where ms.user_id = p_user and ms.emis = p.school_emis and ms.stage = p.school_stage
                      and (p.school_year is null or p.school_year = ms.last_year));

  insert into public.pools (season, name, created_by, school_emis, school_stage)
  select s.id, left(sc.name, 40), p_user, ms.emis, ms.stage
  from public.member_schools ms
  join public.schools sc on sc.emis = ms.emis
  cross join public.seasons s
  where ms.user_id = p_user
  on conflict (season, school_emis, school_stage) where school_emis is not null and school_year is null do nothing;

  insert into public.pools (season, name, created_by, school_emis, school_stage, school_year)
  select s.id, public.class_pool_name(sc.name, ms.last_year), p_user, ms.emis, ms.stage, ms.last_year
  from public.member_schools ms
  join public.schools sc on sc.emis = ms.emis
  cross join public.seasons s
  where ms.user_id = p_user and ms.last_year is not null
  on conflict (season, school_emis, school_stage, school_year) where school_year is not null do nothing;

  insert into public.pool_members (pool_id, user_id)
  select p.id, p_user
  from public.member_schools ms
  join public.pools p on p.school_emis = ms.emis and p.school_stage = ms.stage
                     and (p.school_year is null or p.school_year = ms.last_year)
  where ms.user_id = p_user
  on conflict do nothing;
end $$;
revoke execute on function public.sync_school_pools(uuid) from anon, authenticated, public;

-- Whole-school pools have no chat: the talk happens in class pools.
create or replace function public.pool_has_chat(p_pool bigint)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.pools
                     where id = p_pool and school_emis is not null and school_year is null)
$$;
revoke execute on function public.pool_has_chat(bigint) from anon, public;
grant execute on function public.pool_has_chat(bigint) to authenticated;

drop policy "post in your pools" on public.chat_messages;
create policy "post in your pools" on public.chat_messages for insert to authenticated
  with check (author_id = auth.uid() and public.is_pool_member(pool_id) and public.pool_has_chat(pool_id));

-- Class years inside one school, for a whole-school pool you're in.
-- A class's score is the average of its best 5 players with a team this
-- tournament (an empty seat counts 0), so a big class can't win on numbers
-- and a small one only needs five good callers. Withheld below 3 players.
-- No money rides on this table, so schoolmate confirmation isn't required.
create or replace function public.school_classes(p_pool bigint)
returns table (
  school_year smallint,
  players     int,
  points      int,
  average     numeric,
  mine        boolean
)
language sql stable
security definer
set search_path = public
as $$
  with pool as (
    select p.season, p.school_emis, p.school_stage
    from public.pools p
    where p.id = p_pool and p.school_emis is not null and p.school_year is null
      and public.is_pool_member(p.id)
  ), players as (
    select ms.user_id, ms.last_year, e.id as entry_id
    from pool
    join public.member_schools ms on ms.emis = pool.school_emis and ms.stage = pool.school_stage
    left join public.entries e on e.user_id = ms.user_id and e.season = pool.season
    where ms.last_year is not null
  ), pts as (
    select t.entry_id, sum(t.total_pts)::int as pts
    from public.entry_round_totals t
    where t.season = (select season from pool)
    group by t.entry_id
  ), ranked as (
    select p.*, coalesce(t.pts, 0) as pts,
           row_number() over (partition by p.last_year
                              order by (p.entry_id is not null) desc, coalesce(t.pts, 0) desc) as rn
    from players p
    left join pts t on t.entry_id = p.entry_id
  )
  select r.last_year,
         (count(*) filter (where r.entry_id is not null))::int,
         case when count(*) filter (where r.entry_id is not null) >= 3
              then (coalesce(sum(r.pts) filter (where r.entry_id is not null and r.rn <= 5), 0))::int end,
         case when count(*) filter (where r.entry_id is not null) >= 3
              then round(coalesce(sum(r.pts) filter (where r.entry_id is not null and r.rn <= 5), 0)::numeric / 5, 1) end,
         bool_or(r.user_id = auth.uid())
  from ranked r
  group by r.last_year
$$;
revoke all on function public.school_classes(bigint) from public, anon;
grant execute on function public.school_classes(bigint) to authenticated;

-- Everyone who has already saved a school with a year.
select public.sync_school_pools(u.user_id) from (select distinct user_id from public.member_schools) u;
