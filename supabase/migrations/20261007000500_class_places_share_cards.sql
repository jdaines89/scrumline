-- Class years where people look for them, and pictures worth sharing.
--   school_classes_at: one school's class years against each other, for its school page (any player can see it,
--     as the page already lists who went there and their year);
--   my_class_places: where your own class stands at each of your schools, for the Leagues screen;
--   my_share_moments: the moments from your last day and a half worth a picture for WhatsApp Status:
--     an exact call, being the only one in a league who backed the winner, topping a league for a round,
--     and your class leading your school. Other players appear only as counts, never by name.
-- Read-only functions, plus one analytics event name.

-- The same table as school_classes (best 5 callers per class, ranked once 3 are playing), by school instead of league.
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
         case when count(*) filter (where r.entry_id is not null) >= 3
              then (coalesce(sum(r.pts) filter (where r.entry_id is not null and r.rn <= 5), 0))::int end,
         case when count(*) filter (where r.entry_id is not null) >= 3
              then round(coalesce(sum(r.pts) filter (where r.entry_id is not null and r.rn <= 5), 0)::numeric / 5, 1) end,
         bool_or(r.user_id = auth.uid())
  from ranked r
  group by r.last_year
$$;
revoke all on function public.school_classes_at(text, text, text) from public, anon;
grant execute on function public.school_classes_at(text, text, text) to authenticated;

-- Your class at each of your schools: its place among the ranked classes, or how many of it are playing so far.
create or replace function public.my_class_places(p_season text)
returns table (
  emis        text,
  stage       text,
  school_year smallint,
  place       int,
  ranked      int,
  players     int
)
language sql stable
security definer
set search_path = public
as $$
  with mine as (
    select ms.emis, ms.stage, ms.last_year
    from public.member_schools ms
    where ms.user_id = auth.uid() and ms.last_year is not null
  ), cls as (
    select m.emis as c_emis, m.stage as c_stage, c.school_year as c_year, c.players as c_players, c.average as c_avg
    from mine m
    cross join lateral public.school_classes_at(m.emis, m.stage, p_season) c
  )
  select m.emis, m.stage, m.last_year,
         case when y.c_avg is not null
              then 1 + (select count(*) from cls o where o.c_emis = m.emis and o.c_stage = m.stage and o.c_avg > y.c_avg)::int end,
         (select count(*) from cls o where o.c_emis = m.emis and o.c_stage = m.stage and o.c_avg is not null)::int,
         coalesce(y.c_players, 0)
  from mine m
  left join cls y on y.c_emis = m.emis and y.c_stage = m.stage and y.c_year = m.last_year
$$;
revoke all on function public.my_class_places(text) from public, anon;
grant execute on function public.my_class_places(text) to authenticated;

-- The signed-in player's moments worth sharing, from games that finished in the last day and a half
-- (the same window and tournament as the full-time card on Home).
create or replace function public.my_share_moments()
returns jsonb
language sql stable
security definer
set search_path = public
as $$
  with me as (
    select auth.uid() as uid where public.is_member()
  ), mine as (
    select pp.*, m.home_team_id, m.away_team_id, m.kickoff_at
    from me
    join public.entries e on e.user_id = me.uid
    join public.prediction_points pp on pp.entry_id = e.id
    join public.matches m on m.id = pp.match_id
    join public.seasons s on s.id = m.season and not s.is_replay
    where m.status in ('FT', 'INTR') and m.kickoff_at >= now() - interval '36 hours'
  ), latest as (
    select season from mine order by kickoff_at desc limit 1
  ), fresh as (
    select * from mine where season = (select season from latest)
  ), names as (
    select f.match_id, th.display_name as home, ta.display_name as away,
           case when f.real_home > f.real_away then th.display_name else ta.display_name end as winner
    from fresh f
    join public.teams th on th.id = f.home_team_id
    join public.teams ta on ta.id = f.away_team_id
  ),
  -- Spot on: how many of everyone who called the game got it exactly.
  exact as (
    select f.match_id, f.kickoff_at, f.real_home, f.real_away, f.is_banker, f.total_pts,
           (select count(*) from public.prediction_points q where q.match_id = f.match_id) as callers,
           (select count(*) from public.prediction_points q where q.match_id = f.match_id and q.exact_pts > 0) as same
    from fresh f
    where f.exact_pts > 0
  ),
  -- The only one in a league of 3+ callers who backed the winner (draws don't count); the biggest such league.
  lone as (
    select distinct on (f.match_id) f.match_id, f.kickoff_at, f.real_home, f.real_away, f.pred_home, f.pred_away,
           coalesce(p.full_name, p.name) as league, x.callers
    from fresh f
    join public.pool_members pm on pm.user_id = (select uid from me)
    join public.pools p on p.id = pm.pool_id and p.season = f.season
    cross join lateral (
      select count(*) as callers, count(*) filter (where q.right_result) as backed
      from public.pool_members o
      join public.entries oe on oe.user_id = o.user_id and oe.season = f.season
      join public.prediction_points q on q.entry_id = oe.id and q.match_id = f.match_id
      where o.pool_id = p.id
    ) x
    where f.right_result and f.real_home <> f.real_away and x.callers >= 3 and x.backed = 1
    order by f.match_id, x.callers desc, p.id
  ),
  -- The latest round you called that has now finished everywhere.
  done_round as (
    select f.season, max(f.round) as round
    from fresh f
    where not exists (select 1 from public.matches m where m.season = f.season and m.round = f.round and m.status = 'SCHEDULED')
    group by f.season
  ),
  pool_round as (
    select p.id as pool_id, coalesce(p.full_name, p.name) as league, o.user_id, t.total_pts
    from done_round d
    join public.pool_members pm on pm.user_id = (select uid from me)
    join public.pools p on p.id = pm.pool_id and p.season = d.season and coalesce(p.counts_from_round, 0) <= d.round
    join public.pool_members o on o.pool_id = p.id
    join public.entries oe on oe.user_id = o.user_id and oe.season = d.season
    join public.entry_round_totals t on t.entry_id = oe.id and t.round = d.round
  ),
  -- Top of a league of 3+ for that round, the biggest such league.
  round_top as (
    select r.pool_id, r.league, count(*) as callers, max(r.total_pts) as pts,
           count(*) filter (where r.total_pts = (select max(x.total_pts) from pool_round x where x.pool_id = r.pool_id)) as at_top
    from pool_round r
    group by r.pool_id, r.league
    having count(*) >= 3 and max(r.total_pts) > 0
       and max(r.total_pts) = max(r.total_pts) filter (where r.user_id = (select uid from me))
    order by count(*) desc, r.pool_id
    limit 1
  ),
  -- Your class first at your school, among two or more ranked classes, once a round has finished.
  class_lead as (
    select s.name as school, c.place, c.ranked, c.school_year
    from done_round d
    cross join lateral public.my_class_places(d.season) c
    join public.schools s on s.emis = c.emis
    where c.place = 1 and c.ranked >= 2
    order by c.stage = 'high' desc
    limit 1
  )
  select case when not exists (select 1 from fresh) then null else jsonb_build_object(
    'season', (select season from latest),
    'round', (select round from done_round),
    'exact', coalesce((select jsonb_agg(jsonb_build_object(
        'match_id', e.match_id, 'home', n.home, 'away', n.away, 'home_score', e.real_home, 'away_score', e.real_away,
        'pts', e.total_pts, 'banker', e.is_banker, 'callers', e.callers, 'same', e.same) order by e.kickoff_at desc)
      from exact e join names n on n.match_id = e.match_id), '[]'::jsonb),
    'lone', coalesce((select jsonb_agg(jsonb_build_object(
        'match_id', l.match_id, 'home', n.home, 'away', n.away, 'home_score', l.real_home, 'away_score', l.real_away,
        'pred_home', l.pred_home, 'pred_away', l.pred_away, 'winner', n.winner, 'league', l.league, 'callers', l.callers)
        order by l.kickoff_at desc)
      from lone l join names n on n.match_id = l.match_id), '[]'::jsonb),
    'round_top', (select jsonb_build_object('league', t.league, 'callers', t.callers, 'pts', t.pts, 'joint', t.at_top > 1)
      from round_top t),
    'class_lead', (select jsonb_build_object('school', c.school, 'school_year', c.school_year, 'ranked', c.ranked)
      from class_lead c)
  ) end
$$;
revoke all on function public.my_share_moments() from public, anon;
grant execute on function public.my_share_moments() to authenticated;

-- Counting shares of the new pictures, like round recaps.
insert into analytics.event_names (name, source, description) values
  ('moment_shared', 'app', 'A member shared a moment picture (exact call, lone call, round top or class lead)')
on conflict (name) do update set source = excluded.source, description = excluded.description;
