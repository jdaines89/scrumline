-- Bok days: a table per league that counts only the Springboks' tests, so a
-- fan who calls just the Bok game each Bok weekend gets a fair table with the
-- people in their league. It reads the calls players already make (no new
-- calls, no new entries), so the tournament tables are untouched.
-- The Banker is left out: everyone calls the same few games, so a double on
-- the one game would just be a free extra.

create or replace function public.is_bok_test(p_home text, p_away text)
returns boolean language sql immutable as $$
  select '137137' in (p_home, p_away)
$$;
comment on function public.is_bok_test(text, text) is
  'True when the Springboks (feed team 137137) play in the match.';

create or replace view public.bok_days_table with (security_invoker = true) as
  with league_people as (
    select distinct coalesce(p.league_id, p.id) as league_id, pm.user_id
    from public.pool_members pm
    join public.pools p on p.id = pm.pool_id
  )
  select lp.league_id,
         extract(year from m.kickoff_at at time zone 'Africa/Johannesburg')::int as year,
         lp.user_id,
         mb.display_name,
         sum(pp.result_pts + pp.margin_pts + pp.near_pts + pp.exact_pts)::bigint as points,
         count(*)::bigint as tests_called,
         count(*) filter (where pp.right_result)::bigint as right_results,
         count(*) filter (where pp.exact_pts > 0)::bigint as exact_scores
  from league_people lp
  join public.members mb on mb.user_id = lp.user_id
  join public.entries e on e.user_id = lp.user_id
  join public.seasons s on s.id = e.season and not s.is_replay
  join public.prediction_points pp on pp.entry_id = e.id
  join public.matches m on m.id = pp.match_id and public.is_bok_test(m.home_team_id, m.away_team_id)
  group by lp.league_id, year, lp.user_id, mb.display_name;

grant select on public.bok_days_table to authenticated;
grant execute on function public.is_bok_test(text, text) to authenticated;
