-- How a school's score adds up: one row per round that counted, with the
-- round's average (of its best school_team_size() players), how many played,
-- the running total, and who counted. Same rules as school_table(), for one
-- school only, so it stays cheap. Running totals are rounded the way the table
-- rounds, and each round's "adds" is the step between them, so the rows add
-- up exactly to the table's score. Names are already visible to any member
-- on the school page.
create or replace function public.school_score_breakdown(p_emis text, p_stage text, p_season text)
returns jsonb
language sql stable security definer
set search_path to 'public'
as $$
  with played as (
    select t.round, t.total_pts, m.display_name,
           row_number() over (partition by t.round order by t.total_pts desc, m.display_name) as rn,
           count(*) over (partition by t.round) as turnout
    from public.school_members sm
    join public.entries e on e.user_id = sm.user_id and e.season = p_season
    join public.entry_round_totals t on t.entry_id = e.id and t.season = p_season and t.matches > 0
    join public.members m on m.user_id = sm.user_id
    where sm.emis = p_emis and sm.stage = p_stage and sm.verified and public.is_member()
  ), rounds as (
    select round, max(turnout)::int as turnout,
           avg(total_pts) filter (where rn <= public.school_team_size()) as avg_pts,
           (count(*) filter (where rn <= public.school_team_size()))::int as counted,
           jsonb_agg(jsonb_build_object('name', display_name, 'pts', total_pts) order by rn)
             filter (where rn <= public.school_team_size()) as players
    from played
    group by round
    having max(turnout) >= public.school_round_minimum()
  ), run as (
    select r.*, round(sum(avg_pts) over (order by round), 1) as running
    from rounds r
  ), steps as (
    select run.*, running - coalesce(lag(running) over (order by round), 0) as adds
    from run
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'round', round, 'turnout', turnout, 'counted', counted,
           'average', round(avg_pts, 2),
           'adds', adds,
           'running', running, 'players', players) order by round), '[]'::jsonb)
  from steps
$$;

revoke all on function public.school_score_breakdown(text, text, text) from public, anon;
grant execute on function public.school_score_breakdown(text, text, text) to authenticated;
