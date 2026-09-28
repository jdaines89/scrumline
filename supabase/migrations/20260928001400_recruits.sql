-- Credit for bringing people in.
--
-- There are no points for inviting (the game stays fair); instead a player
-- gets quiet credit: "brought in N" on their leaderboard row and profile,
-- and each school pool names its top recruiter of the month. Only people
-- who went on to make at least one call count, so sending a link to an
-- inbox that never plays earns nothing.

create or replace function public.recruit_counts()
returns table (user_id uuid, brought_in int, this_month int)
language sql stable
security definer
set search_path = public
as $$
  select i.invited_by,
         count(*)::int,
         count(*) filter (
           where i.created_at >= (date_trunc('month', now() at time zone 'Africa/Johannesburg')
                                  at time zone 'Africa/Johannesburg'))::int
  from public.invites i
  where exists (select 1 from public.entries e
                join public.predictions p on p.entry_id = e.id
                where e.user_id = i.invitee_id)
  group by i.invited_by
$$;
revoke execute on function public.recruit_counts() from public, anon, authenticated;

-- Everyone in a pool you're in, with how many players they brought in.
create or replace function public.pool_recruits(p_pool bigint)
returns table (user_id uuid, brought_in int, this_month int)
language sql stable
security definer
set search_path = public
as $$
  select pm.user_id, r.brought_in, r.this_month
  from public.pool_members pm
  join public.recruit_counts() r on r.user_id = pm.user_id
  where pm.pool_id = p_pool and public.is_pool_member(p_pool)
$$;

-- Your own count, for the profile page.
create or replace function public.my_recruits()
returns int
language sql stable
security definer
set search_path = public
as $$
  select coalesce((select brought_in from public.recruit_counts() where user_id = auth.uid()), 0)
$$;

revoke execute on function public.pool_recruits(bigint), public.my_recruits() from public, anon;
grant execute on function public.pool_recruits(bigint), public.my_recruits() to authenticated;
