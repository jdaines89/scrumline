-- The member who offers a round prize can't win it: it goes to the best of everyone else.
-- They still play and appear on the leaderboard as normal.
create or replace function public.prize_outcome(p_pool bigint, p_round integer)
returns table (started boolean, complete boolean, due_at timestamptz, winners uuid[])
language sql stable security definer
set search_path = public
as $$
  with p as (
    select season from public.pools where id = p_pool
  ), giver as (
    select offered_by from public.round_prizes where pool_id = p_pool and round = p_round
  ), r as (
    select min(m.kickoff_at) as first_ko, max(m.kickoff_at) as last_ko,
           bool_and(m.status in ('FT', 'INTR', 'POSTP')) and bool_or(m.status in ('FT', 'INTR')) as done
    from public.matches m join p on m.season = p.season
    where m.round = p_round
  ), eligible as (
    select pm.user_id,
           coalesce(sum(pp.total_pts), 0) as pts,
           count(pp.match_id) filter (where pp.exact_pts > 0) as ex,
           count(pp.match_id) filter (where pp.right_result) as rr
    from public.pool_members pm
    cross join p
    cross join r
    join public.entries e on e.user_id = pm.user_id and e.season = p.season
    left join (public.prediction_points pp join public.matches m on m.id = pp.match_id)
      on pp.entry_id = e.id and pp.round = p_round and m.kickoff_at >= pm.joined_at
    where pm.pool_id = p_pool and pm.joined_at <= r.last_ko
      and pm.user_id is distinct from (select offered_by from giver)
    group by pm.user_id
  ), best as (
    select pts, ex, rr from eligible order by pts desc, ex desc, rr desc limit 1
  )
  select coalesce(r.first_ko <= now(), false),
         coalesce(r.done, false),
         r.last_ko + interval '14 days',
         case when r.done then (select array_agg(e.user_id order by e.user_id)
                                from eligible e cross join best b
                                where b.pts > 0 and e.pts = b.pts and e.ex = b.ex and e.rr = b.rr) end
  from r
$$;
