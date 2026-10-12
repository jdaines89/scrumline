-- Provinces against each other for a tournament. A player plays for the
-- province of their high school (their primary school if they only added
-- one); players with no school sit out. Each round a province scores the
-- average of its best province_team_size() players who played that round,
-- so a small province with good callers can beat a big one; the season score
-- adds the rounds up, like the schools table. A round counts once
-- province_round_minimum() of its players played (1 while the school rules
-- trial is on, 25 after). Only confirmed schoolmates count, as for schools.
-- Tapping a province shows its top five teams (team names only, as the
-- Everyone table does) and the schools with the most players in it.
-- Set-based over the season's totals; no per-row functions.

create or replace function public.province_team_size() returns int language sql immutable as $$ select 50 $$;

create or replace function public.province_round_minimum() returns int language sql immutable as $$
  select case when public.school_rules_relaxed() then 1 else 25 end
$$;

create or replace function public.province_table(p_season text)
returns jsonb
language sql stable
security definer
set search_path to 'public'
as $$
  with home as (
    -- one school per player: high school first, else primary
    select distinct on (sm.user_id) sm.user_id, sm.emis, sc.province
    from public.school_members sm
    join public.schools sc on sc.emis = sm.emis
    where sm.verified and public.is_member()
    order by sm.user_id, (sm.stage = 'high') desc
  ), players as (
    select h.user_id, h.emis, h.province, e.id as entry_id, e.team_name
    from home h
    join public.entries e on e.user_id = h.user_id and e.season = p_season
  ), played as (
    select p.province, t.round, t.total_pts,
           row_number() over (partition by p.province, t.round order by t.total_pts desc, p.user_id) as rn,
           count(*) over (partition by p.province, t.round) as turnout
    from players p
    join public.entry_round_totals t on t.entry_id = p.entry_id and t.season = p_season and t.matches > 0
  ), rounds as (
    select province, round,
           avg(total_pts) filter (where rn <= public.province_team_size()) as avg_pts
    from played
    group by province, round
    having max(turnout) >= public.province_round_minimum()
  ), scored as (
    select province, round(sum(avg_pts), 1) as score, count(*)::int as rounds
    from rounds group by province
  ), season_pts as (
    select p.province, p.team_name, p.user_id, coalesce(sum(t.total_pts), 0)::int as pts
    from players p
    left join public.entry_round_totals t on t.entry_id = p.entry_id and t.season = p_season
    group by p.province, p.team_name, p.user_id
  ), top_players as (
    select province, jsonb_agg(jsonb_build_object('team_name', team_name, 'points', pts, 'mine', user_id = auth.uid())
                               order by pts desc, team_name) as top
    from (select s.*, row_number() over (partition by province order by pts desc, team_name) as rn from season_pts s) x
    where rn <= 5
    group by province
  ), school_counts as (
    select p.province, p.emis, count(*)::int as n from players p group by p.province, p.emis
  ), top_schools as (
    select x.province, jsonb_agg(jsonb_build_object('emis', x.emis, 'name', sc.name, 'players', x.n)
                                 order by x.n desc, sc.name) as schools
    from (select c.*, row_number() over (partition by province order by n desc, emis) as rn from school_counts c) x
    join public.schools sc on sc.emis = x.emis
    where x.rn <= 5
    group by x.province
  ), per as (
    select province, count(*)::int as players, bool_or(user_id = auth.uid()) as mine
    from players group by province
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'province', per.province, 'players', per.players, 'mine', per.mine,
           'score', s.score, 'rounds', coalesce(s.rounds, 0),
           'top', coalesce(tp.top, '[]'::jsonb), 'schools', coalesce(ts.schools, '[]'::jsonb))), '[]'::jsonb)
  from per
  left join scored s using (province)
  left join top_players tp using (province)
  left join top_schools ts using (province)
$$;

revoke all on function public.province_table(text) from public, anon;
grant execute on function public.province_table(text) to authenticated;
