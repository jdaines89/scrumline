-- Invite links: a fresh link after every 20 joins.
--
-- Before, a personal link never ran out while the people it brought in kept
-- playing, which read as odd and left one link live forever. Now the 20th
-- person to join with a link retires it: the owner's code changes by itself
-- and the count starts again. People already in are not affected. The cap of
-- 20 who haven't played yet stays as a second brake on fake sign-ups.

alter table public.invite_codes add column if not exists started_at timestamptz not null default now();

-- How many joined with the owner's current link.
create or replace function public.invites_on_link(p_user uuid)
returns int
language sql stable
security definer
set search_path = public
as $$
  select count(*)::int from public.invites i
  join public.invite_codes c on c.user_id = i.invited_by
  where i.invited_by = p_user and i.created_at >= c.started_at
$$;
revoke all on function public.invites_on_link(uuid) from public, anon, authenticated;

create or replace function public.invite_record(p_invitee uuid, p_inviter uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.invites (invitee_id, invited_by, email)
  values (p_invitee, p_inviter, lower(btrim(p_email)))
  on conflict (invitee_id) do nothing;
  if public.invites_on_link(p_inviter) >= 20 then
    update public.invite_codes set code = public.new_invite_code(), started_at = clock_timestamp()
    where user_id = p_inviter;
  end if;
end $$;

-- A fresh link by hand also starts the count again.
create or replace function public.reset_invite_code()
returns text
language sql
security definer
set search_path = public
as $$
  update public.invite_codes set code = public.new_invite_code(), started_at = clock_timestamp()
  where user_id = auth.uid()
  returning code
$$;

-- used now means "joined with this link" (out of cap).
create or replace function public.my_invite()
returns table (code text, used int, cap int, waiting int)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_member() then return; end if;
  insert into public.invite_codes (user_id, code) values (auth.uid(), public.new_invite_code())
  on conflict (user_id) do nothing;
  return query
    select c.code, public.invites_on_link(auth.uid()), 20, public.invites_waiting(auth.uid())
    from public.invite_codes c where c.user_id = auth.uid();
end $$;
