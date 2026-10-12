-- The schools race: running score round by round for the top schools of a
-- stage, plus the viewer's own school. Same rules as school_table() and
-- school_score_breakdown(): a round counts when school_round_minimum() players
-- played, and scores the average of the best school_team_size(). A school with
-- no row for a round carries its total forward (the page does that).
create or replace function public.school_race(p_season text, p_stage text, p_limit int default 8)
returns jsonb
language sql stable security definer
set search_path to 'public'
as $$
  with played as (
    select sm.emis, t.round, t.total_pts,
           row_number() over (partition by sm.emis, t.round order by t.total_pts desc, sm.user_id) as rn,
           count(*) over (partition by sm.emis, t.round) as turnout
    from public.school_members sm
    join public.entries e on e.user_id = sm.user_id and e.season = p_season
    join public.entry_round_totals t on t.entry_id = e.id and t.season = p_season and t.matches > 0
    where sm.stage = p_stage and sm.verified and public.is_member()
  ), rounds as (
    select emis, round,
           avg(total_pts) filter (where rn <= public.school_team_size()) as avg_pts
    from played
    group by emis, round
    having max(turnout) >= public.school_round_minimum()
  ), run as (
    select emis, round, round(sum(avg_pts) over (partition by emis order by round), 1) as running
    from rounds
  ), final as (
    select emis, max(running) as total from run group by emis
  ), mine as (
    select distinct emis from public.school_members where user_id = auth.uid() and stage = p_stage
  ), picked as (
    (select f.emis from final f order by f.total desc, f.emis limit greatest(1, least(p_limit, 12)))
    union
    select f.emis from final f join mine using (emis)
  )
  select jsonb_build_object(
    'rounds', coalesce((select jsonb_agg(distinct round order by round) from run where emis in (select emis from picked)), '[]'::jsonb),
    'schools', coalesce((
      select jsonb_agg(jsonb_build_object(
               'emis', p.emis, 'name', sc.name, 'mine', p.emis in (select emis from mine),
               'points', (select jsonb_agg(jsonb_build_object('round', r.round, 'running', r.running) order by r.round)
                          from run r where r.emis = p.emis))
             order by (select total from final where emis = p.emis) desc)
      from picked p join public.schools sc on sc.emis = p.emis), '[]'::jsonb))
$$;

revoke all on function public.school_race(text, text, int) from public, anon;
grant execute on function public.school_race(text, text, int) to authenticated;
