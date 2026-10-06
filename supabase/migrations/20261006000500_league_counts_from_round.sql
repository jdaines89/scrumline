-- A league can count from a chosen round, so friends who join part-way through
-- a tournament start level. Rounds before it still count in every other league
-- and for schools; this league's table, points race and recap just leave them out.
alter table public.pools add column if not exists counts_from_round int
  check (counts_from_round is null or counts_from_round between 1 and 999);

-- Same view as before; the only change is that rounds before the league's start are left out.
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
    and (p.counts_from_round is null or t.round >= p.counts_from_round)
  group by pm.pool_id, pm.user_id, mb.display_name, e.id, e.team_name, p.season, pm.joined_at;

-- Whoever started a league (not a school one) picks the round it counts from; null means every round.
create or replace function public.set_league_start(p_pool bigint, p_round int)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if p_round is not null and (p_round < 1 or p_round > 999) then
    raise exception 'Pick a round from the tournament' using errcode = '22023';
  end if;
  update public.pools set counts_from_round = p_round
   where id = p_pool and created_by = auth.uid() and school_emis is null;
  if not found then
    raise exception 'Only whoever started this league can change where it counts from' using errcode = '42501';
  end if;
end $$;
revoke execute on function public.set_league_start(bigint, int) from public, anon;
grant execute on function public.set_league_start(bigint, int) to authenticated;

-- No chat recap for rounds before a league starts counting.
create or replace function public.post_round_recaps()
returns integer
language plpgsql security definer
set search_path = public
as $$
declare n integer;
begin
  insert into public.chat_notices (pool_id, kind, round)
  select p.id, 'round_recap', r.round
  from public.pools p
  join public.seasons s on s.id = p.season and not s.is_replay
  join lateral (
    select m.round, max(m.kickoff_at) as last_ko
    from public.matches m
    where m.season = p.season and m.round is not null
    group by m.round
    having bool_and(m.status in ('FT', 'INTR', 'POSTP')) and bool_or(m.status in ('FT', 'INTR'))
  ) r on r.last_ko > now() - interval '3 days'
  where public.pool_has_chat(p.id)
    and (p.counts_from_round is null or r.round >= p.counts_from_round)
    and (select count(*) from public.pool_members pm
         join public.entries e on e.user_id = pm.user_id and e.season = p.season
         join public.entry_round_totals t on t.entry_id = e.id and t.round = r.round
         where pm.pool_id = p.id and t.matches > 0) >= 2
    and not exists (select 1 from public.chat_notices c
                    where c.pool_id = p.id and c.kind = 'round_recap' and c.round = r.round)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.post_round_recaps() from public, anon, authenticated;
