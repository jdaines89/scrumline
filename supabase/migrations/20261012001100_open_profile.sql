-- Players choose who can open their profile from the Everyone table:
-- just the people in their leagues (the default, as before), or everyone.
-- everyone_board is everyone_table plus a row's user id, handed back only
-- when you may open it: your own row, a league mate's, or a player who chose
-- Everyone. everyone_table stays as it was for app copies not yet refreshed.
alter table public.members add column if not exists open_profile boolean not null default false;
grant update (open_profile) on public.members to authenticated;
create function public.everyone_board(p_season text)
returns table (user_id uuid, pos int, place int, team_name text, points int, mine boolean, players int, resting_players int)
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
    select playing.pos from playing where playing.user_id = auth.uid()
  ), mates as (
    select pm2.user_id
    from public.pool_members pm1
    join public.pool_members pm2 on pm2.pool_id = pm1.pool_id
    where pm1.user_id = auth.uid()
  )
  select case when p.user_id = auth.uid() or mb.open_profile or p.user_id in (select user_id from mates)
              then p.user_id end,
         p.pos::int, p.place::int, p.team_name, p.pts, p.user_id = auth.uid(),
         (select count(*) from playing)::int, (select count(*) from board where resting)::int
  from playing p
  join public.members mb on mb.user_id = p.user_id
  where p.pos <= 3 or abs(p.pos - (select pos from me)) <= 2
  union all
  select b.user_id, null, null, b.team_name, b.pts, true,
         (select count(*) from playing)::int, (select count(*) from board where resting)::int
  from board b
  where b.user_id = auth.uid() and b.resting
$$;
revoke execute on function public.everyone_board(text) from public, anon;
grant execute on function public.everyone_board(text) to authenticated;
