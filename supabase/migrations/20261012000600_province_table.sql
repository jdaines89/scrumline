-- Provinces against each other for a tournament, by their schools. A school
-- belongs to the province the EMIS list gives it, and scores exactly what the
-- schools table gives it (school_table(): the average of its best players each
-- round, added up). A province scores the average of its best
-- province_team_size() schools, so a province with many schools isn't ahead
-- just for being big. High and primary schools are ranked separately, as on the
-- schools table, and the same trial switch applies (a school ranks once one
-- player has played). Players only ever count through their school; nobody
-- without one is in it, and no names beyond the schools' own show here.
-- Tapping a province shows its top five schools.

create or replace function public.province_team_size() returns int language sql immutable as $$ select 50 $$;

create or replace function public.province_table(p_season text, p_stage text)
returns jsonb
language sql stable
security definer
set search_path to 'public'
as $$
  with s as (
    select st.emis, st.name, st.town, st.confirmed, st.score, st.mine, sc.province,
           row_number() over (partition by sc.province order by st.score desc, st.name) as rn
    from public.school_table(p_season, p_stage) st
    join public.schools sc on sc.emis = st.emis
    where st.score is not null
  ), scored as (
    select province, round(avg(score) filter (where rn <= public.province_team_size()), 1) as score,
           count(*)::int as schools, sum(confirmed)::int as players, bool_or(mine) as mine
    from s group by province
  ), top as (
    select province, jsonb_agg(jsonb_build_object('emis', emis, 'name', name, 'town', town, 'score', score, 'mine', mine)
                               order by score desc, name) as top
    from s where rn <= 5 group by province
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'province', sc.province, 'schools', sc.schools, 'players', sc.players, 'mine', sc.mine,
           'score', sc.score, 'top', t.top)), '[]'::jsonb)
  from scored sc join top t using (province)
$$;

revoke all on function public.province_table(text, text) from public, anon;
grant execute on function public.province_table(text, text) to authenticated;
