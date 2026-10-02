-- One link to bring a mate straight into your league: /join/?c=<your invite
-- code>&p=<league code>. A newcomer signs up through your invite and is
-- already in the league when they first sign in; someone already on
-- Scrumline just joins it.

-- What a league link shows before anyone signs in: the league's name, its
-- tournament and how many play in it. Only for a code you already hold, and
-- never a school's league (those join by saved school, not by code).
create or replace function public.pool_invite_info(p_code text)
returns table (pool_name text, season_name text, players int)
language sql stable
security definer
set search_path = public
as $$
  select p.name, s.name, (select count(*)::int from public.pool_members pm where pm.pool_id = p.id)
  from public.pools p join public.seasons s on s.id = p.season
  where p.join_code = upper(btrim(p_code)) and p.school_emis is null
$$;
revoke execute on function public.pool_invite_info(text) from public;
grant execute on function public.pool_invite_info(text) to anon, authenticated;

-- After recording the invite, the join function passes the league code; the
-- newcomer goes straight into that league if the inviter plays in it.
create or replace function public.invite_join_pool(p_invitee uuid, p_inviter uuid, p_pool text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pid bigint;
begin
  if nullif(btrim(p_pool), '') is null then return; end if;
  select p.id into pid from public.pools p
  where p.join_code = upper(btrim(p_pool)) and p.school_emis is null
    and exists (select 1 from public.pool_members pm where pm.pool_id = p.id and pm.user_id = p_inviter);
  if pid is not null and exists (select 1 from public.members where user_id = p_invitee)
     and exists (select 1 from public.invites where invitee_id = p_invitee and invited_by = p_inviter) then
    insert into public.pool_members (pool_id, user_id) values (pid, p_invitee) on conflict do nothing;
  end if;
end $$;
revoke all on function public.invite_join_pool(uuid, uuid, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.invite_join_pool(uuid, uuid, text) to service_role;
  end if;
end $$;
