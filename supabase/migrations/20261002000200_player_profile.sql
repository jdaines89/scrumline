-- A player's profile, as other players see it: their record in every
-- tournament and the businesses they run on Scrumline.
--
-- entry_round_totals only shows your own totals and pool mates', so a
-- player's record in a tournament you share no pool with comes from here,
-- as season totals and a rank only (never their calls). Businesses come
-- from sponsor_managers, which is otherwise private to the business; only
-- the public face (name, logo, blurb, website) is returned, never the email.

create or replace function public.player_record(p_user uuid)
returns table (season text, season_name text, team_name text, points integer, rank integer, players integer,
               matches integer, right_results integer, exact_scores integer)
language sql stable
security definer
set search_path = public
as $$
  with totals as (
    select e.id, e.user_id, e.season, e.team_name, e.created_at,
           coalesce(sum(t.total_pts), 0)::int as points,
           coalesce(sum(t.matches), 0)::int as matches,
           coalesce(sum(t.right_results), 0)::int as right_results,
           coalesce(sum(t.exact_scores), 0)::int as exact_scores
    from public.entries e
    left join public.entry_round_totals t on t.entry_id = e.id
    where e.season in (select x.season from public.entries x where x.user_id = p_user)
    group by e.id
  ), ranked as (
    select t.*,
           (rank() over (partition by t.season order by t.points desc))::int as rank,
           (count(*) over (partition by t.season))::int as players
    from totals t
  )
  select r.season, s.name, r.team_name, r.points, r.rank, r.players, r.matches, r.right_results, r.exact_scores
  from ranked r
  join public.seasons s on s.id = r.season
  where r.user_id = p_user and public.is_member()
  order by r.created_at desc
$$;
revoke execute on function public.player_record(uuid) from public, anon;
grant execute on function public.player_record(uuid) to authenticated;

create or replace function public.player_businesses(p_user uuid)
returns table (id bigint, name text, category text, about text, website text, logo_path text)
language sql stable
security definer
set search_path = public
as $$
  select s.id, s.name, s.category, s.about, s.website, s.logo_path
  from public.sponsors s
  join public.sponsor_managers sm on sm.sponsor_id = s.id
  where sm.user_id = p_user and not s.blocked and public.is_member()
  order by s.created_at
$$;
revoke execute on function public.player_businesses(uuid) from public, anon;
grant execute on function public.player_businesses(uuid) to authenticated;
