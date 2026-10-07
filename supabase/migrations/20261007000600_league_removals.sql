-- Removing a player from a league.
--
-- Anyone in a league can invite and anyone with its code can join, so a
-- rogue who got in could bring a crowd of fake accounts with them. Whoever
-- started the league, or an admin, can now remove a player from the whole
-- league (every tournament's table and the chat), keep them from coming back
-- by code or invite link, let them back in, and swap the league's codes so an
-- old one passed around stops working.
--
-- Removing someone never touches their calls: those belong to their entry
-- and still count in their other leagues and on the schools table.
-- School leagues aren't covered; players are placed in those by their school.

-- A league is its tournaments' tables sharing league_id; a table outside a
-- league (a practice replay) is a league of one.
create or replace function public.league_key(p_pool bigint) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(p.league_id, p.id) from public.pools p where p.id = p_pool
$$;

create table if not exists public.league_removals (
  league_id bigint not null,
  user_id uuid not null references public.members(user_id) on delete cascade,
  removed_by uuid not null references public.members(user_id) on delete cascade,
  removed_at timestamptz not null default now(),
  primary key (league_id, user_id)
);
alter table public.league_removals enable row level security;
-- Only the functions below read or write it.
revoke all on public.league_removals from anon, authenticated;

/** May the signed-in player run this league: whoever started it, or an admin. */
create or replace function public.league_runner(p_pool bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.pools p where p.id = p_pool and p.school_emis is null
                 and (p.created_by = auth.uid()
                      or exists (select 1 from public.members m where m.user_id = auth.uid() and m.is_admin)))
$$;

-- Whatever the route in (code, invite link, league invite, a new tournament
-- spreading the league), a removed player isn't added. Quietly, so a sign-up
-- that carries an old league link still creates the account.
create or replace function public.pool_members_removed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.league_removals r
             where r.league_id = public.league_key(new.pool_id) and r.user_id = new.user_id) then
    return null;
  end if;
  return new;
end $$;
create or replace trigger pool_members_removed before insert on public.pool_members
  for each row execute function public.pool_members_removed();

create or replace function public.remove_league_member(p_pool bigint, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  lid bigint := public.league_key(p_pool);
begin
  if not public.league_runner(p_pool) then
    raise exception 'Only whoever started this league can remove players' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'You can''t remove yourself' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.pools p where coalesce(p.league_id, p.id) = lid and p.created_by = p_user) then
    raise exception 'Whoever started the league can''t be removed' using errcode = 'P0001';
  end if;
  insert into public.league_removals (league_id, user_id, removed_by) values (lid, p_user, auth.uid())
  on conflict (league_id, user_id) do update set removed_by = excluded.removed_by, removed_at = now();
  delete from public.pool_members pm
  using public.pools p
  where pm.pool_id = p.id and coalesce(p.league_id, p.id) = lid and pm.user_id = p_user;
  -- A league invite they hadn't answered goes too.
  update public.pool_invites i set answered_at = now(), answer = 'declined'
  from public.pools p
  where i.pool_id = p.id and coalesce(p.league_id, p.id) = lid and i.invitee = p_user and i.answered_at is null;
end $$;

/** Players removed from this league, for the person running it. */
create or replace function public.league_removed(p_pool bigint)
returns table (user_id uuid, display_name text, removed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.user_id, m.display_name, r.removed_at
  from public.league_removals r join public.members m on m.user_id = r.user_id
  where public.league_runner(p_pool) and r.league_id = public.league_key(p_pool)
  order by r.removed_at desc
$$;

/** Lets a removed player join again. They come back the usual way, by code or link. */
create or replace function public.league_let_back(p_pool bigint, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.league_runner(p_pool) then
    raise exception 'Only whoever started this league can do that' using errcode = '42501';
  end if;
  delete from public.league_removals where league_id = public.league_key(p_pool) and user_id = p_user;
end $$;

/** A fresh code for every tournament's table in the league; the old codes stop working. Returns this table's. */
create or replace function public.new_league_code(p_pool bigint) returns text
language plpgsql security definer set search_path = '' as $$
declare
  lid bigint := public.league_key(p_pool);
  pid bigint;
  c text;
begin
  if not public.league_runner(p_pool) then
    raise exception 'Only whoever started this league can change its code' using errcode = '42501';
  end if;
  for pid in select p.id from public.pools p where coalesce(p.league_id, p.id) = lid loop
    loop
      c := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
      exit when not exists (select 1 from public.pools where join_code = c);
    end loop;
    update public.pools set join_code = c where id = pid;
  end loop;
  return (select join_code from public.pools where id = p_pool);
end $$;

-- Joining by code says why, instead of seeming to work and showing nothing.
create or replace function public.join_pool(p_code text)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  pid bigint;
begin
  if not public.is_member() then
    raise exception 'Only Scrumline members can join leagues' using errcode = '42501';
  end if;
  select id into pid from public.pools where join_code = upper(btrim(p_code)) and school_emis is null;
  if pid is null then
    raise exception 'No league has that code' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.league_removals r where r.league_id = public.league_key(pid) and r.user_id = auth.uid()) then
    raise exception 'You were removed from this league, so you can''t join it again' using errcode = 'P0001';
  end if;
  insert into public.pool_members (pool_id, user_id) values (pid, auth.uid()) on conflict do nothing;
  return pid;
end;
$function$;

revoke all on function public.league_key(bigint), public.league_runner(bigint), public.pool_members_removed(),
  public.remove_league_member(bigint, uuid), public.league_removed(bigint), public.league_let_back(bigint, uuid),
  public.new_league_code(bigint) from public, anon;
grant execute on function public.remove_league_member(bigint, uuid), public.league_removed(bigint),
  public.league_let_back(bigint, uuid), public.new_league_code(bigint), public.league_runner(bigint) to authenticated;
