-- Where you stand among everyone playing a tournament, across every league.
-- Players can only read their league mates' totals, so this hands back just
-- the slice they need: the top three and the two either side of them, by
-- team name only (no real names, no ids). Players taking a break (no calls
-- in the last two finished rounds since they joined) sit out of the count,
-- as they do on a league table; their own row still comes back, unranked.
-- One pass over the season's totals, no per-row functions, so it stays quick
-- at thousands of players.
create or replace function public.everyone_table(p_season text)
returns table (pos int, place int, team_name text, points int, mine boolean, players int, resting_players int)
language sql stable
security definer
set search_path = ''
as $$
  with last2 as (
    select m.round, min(m.kickoff_at) as first_ko
    from public.matches m
    where m.season = p_season and m.round is not null
    group by m.round
    having max(m.kickoff_at) < now()
    order by max(m.kickoff_at) desc
    limit 2
  ), called as (
    select distinct pr.entry_id
    from public.predictions pr
    join public.matches m on m.id = pr.match_id
    where m.season = p_season and m.round in (select round from last2)
  ), tot as (
    select t.entry_id, sum(t.total_pts)::int as pts, sum(t.exact_scores)::int as ex
    from public.entry_round_totals t
    where t.season = p_season
    group by t.entry_id
  ), board as (
    select e.user_id, e.team_name, coalesce(tot.pts, 0) as pts, coalesce(tot.ex, 0) as ex,
           ((select count(*) from last2) = 2
            and e.created_at <= (select min(first_ko) from last2)
            and c.entry_id is null) as resting
    from public.entries e
    left join tot on tot.entry_id = e.id
    left join called c on c.entry_id = e.id
    where e.season = p_season and (select public.is_member())
  ), playing as (
    select b.*, rank() over (order by b.pts desc) as place,
           row_number() over (order by b.pts desc, b.ex desc, b.team_name) as pos
    from board b
    where not b.resting
  ), me as (
    select pos from playing where user_id = auth.uid()
  )
  select p.pos::int, p.place::int, p.team_name, p.pts, p.user_id = auth.uid(),
         (select count(*) from playing)::int, (select count(*) from board where resting)::int
  from playing p
  where p.pos <= 3 or abs(p.pos - (select pos from me)) <= 2
  union all
  select null, null, b.team_name, b.pts, true,
         (select count(*) from playing)::int, (select count(*) from board where resting)::int
  from board b
  where b.user_id = auth.uid() and b.resting
$$;
revoke execute on function public.everyone_table(text) from public, anon;
grant execute on function public.everyone_table(text) to authenticated;
