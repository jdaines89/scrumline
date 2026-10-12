-- Trial (temporary, 2026-10-12): class years rank under the same switch as the school rules.
-- While public.school_rules_relaxed() is true, a class ranks once one of it is playing (was 3).
-- Each class still counts its best 5 callers, an empty place counting 0, so scores are unchanged.
-- Flips back with the same switch: school_rules_relaxed() false and SCHOOL_TRIAL = false in src/lib/school.ts.

create or replace function public.class_ranked_minimum() returns int language sql immutable as $$
  select case when public.school_rules_relaxed() then 1 else 3 end
$$;

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
         case when count(*) filter (where r.entry_id is not null) >= public.class_ranked_minimum()
              then (coalesce(sum(r.pts) filter (where r.entry_id is not null and r.rn <= 5), 0))::int end,
         case when count(*) filter (where r.entry_id is not null) >= public.class_ranked_minimum()
              then round(coalesce(sum(r.pts) filter (where r.entry_id is not null and r.rn <= 5), 0)::numeric / 5, 1) end,
         bool_or(r.user_id = auth.uid())
  from ranked r
  group by r.last_year
$$;
revoke all on function public.school_classes(bigint) from public, anon;
grant execute on function public.school_classes(bigint) to authenticated;

create or replace function public.school_classes_at(p_emis text, p_stage text, p_season text)
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
  with players as (
    select ms.user_id, ms.last_year, e.id as entry_id
    from public.member_schools ms
    left join public.entries e on e.user_id = ms.user_id and e.season = p_season
    where ms.emis = p_emis and ms.stage = p_stage and ms.last_year is not null and public.is_member()
  ), pts as (
    select t.entry_id, sum(t.total_pts)::int as pts
    from public.entry_round_totals t
    where t.season = p_season and t.entry_id in (select entry_id from players)
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
         case when count(*) filter (where r.entry_id is not null) >= public.class_ranked_minimum()
              then (coalesce(sum(r.pts) filter (where r.entry_id is not null and r.rn <= 5), 0))::int end,
         case when count(*) filter (where r.entry_id is not null) >= public.class_ranked_minimum()
              then round(coalesce(sum(r.pts) filter (where r.entry_id is not null and r.rn <= 5), 0)::numeric / 5, 1) end,
         bool_or(r.user_id = auth.uid())
  from ranked r
  group by r.last_year
$$;
revoke all on function public.school_classes_at(text, text, text) from public, anon;
grant execute on function public.school_classes_at(text, text, text) to authenticated;
