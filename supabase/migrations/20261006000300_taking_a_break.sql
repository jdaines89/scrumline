-- "Taking a break": a league member who made no calls in the last two finished
-- rounds since they joined that league. They keep every point; the league table
-- just lists them under the table until their next call. Additive only.

-- True when the member called nothing in the last two rounds that started after
-- they joined and have had their last kickoff. Fewer than two such rounds: false.
create or replace function public.is_resting(p_user uuid, p_season text, p_since timestamptz, p_now timestamptz default now())
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  with last2 as (
    select m.round
    from public.matches m
    where m.season = p_season and m.round is not null
    group by m.round
    having min(m.kickoff_at) >= p_since and max(m.kickoff_at) < p_now
    order by max(m.kickoff_at) desc
    limit 2
  )
  select count(*) = 2
     and not exists (
       select 1 from public.predictions pr
       join public.entries e on e.id = pr.entry_id and e.user_id = p_user and e.season = p_season
       join public.matches m on m.id = pr.match_id
       where m.round in (select round from last2))
  from last2
$$;
revoke execute on function public.is_resting(uuid, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.is_resting(uuid, text, timestamptz, timestamptz) to authenticated;

-- Same view as before with one column added at the end.
create or replace view public.pool_leaderboard with (security_invoker = true) as
  select pm.pool_id, pm.user_id, mb.display_name as manager, e.id as entry_id, e.team_name,
         coalesce(sum(t.total_pts), 0)::bigint as total_points,
         coalesce(sum(t.right_results), 0)::bigint as right_results,
         coalesce(sum(t.exact_scores), 0)::bigint as exact_scores,
         count(t.round) filter (where t.matches > 0) as rounds_scored,
         coalesce(sum(t.result_pts), 0)::bigint as res_pts,
         coalesce(sum(t.margin_pts), 0)::bigint as mar_pts,
         coalesce(sum(t.near_pts), 0)::bigint as cls_pts,
         coalesce(sum(t.exact_pts), 0)::bigint as exa_pts,
         coalesce(sum(t.total_pts - t.result_pts - t.margin_pts - t.near_pts - t.exact_pts), 0)::bigint as banker_pts,
         coalesce(sum(t.matches), 0)::bigint as matches_scored,
         public.is_resting(pm.user_id, p.season, pm.joined_at) as resting
  from public.pool_members pm
  join public.pools p on p.id = pm.pool_id
  join public.members mb on mb.user_id = pm.user_id
  left join public.entries e on e.user_id = pm.user_id and e.season = p.season
  left join public.entry_round_totals t on t.entry_id = e.id
  group by pm.pool_id, pm.user_id, mb.display_name, e.id, e.team_name, p.season, pm.joined_at;
