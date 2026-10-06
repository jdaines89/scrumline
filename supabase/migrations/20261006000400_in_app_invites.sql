-- In-app league invites: ask someone you already play with (in any league) to
-- join one of your leagues. They see it on their Leagues screen and accept or
-- wave it off; a push goes out if they have push on. Nobody can look up players
-- they don't already share a league with, and blocks work both ways.
-- Additive only.

create table if not exists public.pool_invites (
  pool_id     bigint not null references public.pools(id) on delete cascade,
  invitee     uuid not null references public.members(user_id) on delete cascade,
  inviter     uuid not null references public.members(user_id) on delete cascade,
  created_at  timestamptz not null default now(),
  answered_at timestamptz,
  answer      text check (answer in ('joined', 'declined')),
  primary key (pool_id, invitee),
  check (invitee <> inviter)
);
alter table public.pool_invites enable row level security;
alter table public.pool_invites force row level security;
revoke all on public.pool_invites from anon, authenticated;
grant select on public.pool_invites to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pool_invites' and policyname = 'your invites') then
    create policy "your invites" on public.pool_invites for select to authenticated
      using (invitee = auth.uid() or inviter = auth.uid());
  end if;
end $$;

-- Either of you blocked the other.
create or replace function public.blocked_either(p_a uuid, p_b uuid)
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.member_blocks b
                 where (b.blocker = p_a and b.blocked = p_b) or (b.blocker = p_b and b.blocked = p_a))
$$;
revoke execute on function public.blocked_either(uuid, uuid) from public, anon, authenticated;

-- People you could invite to this league: everyone you share any league with,
-- who isn't in it yet. `invited` is true once you (or anyone) asked and they
-- haven't answered; `declined` once they said not now.
create or replace function public.invite_candidates(p_pool bigint)
returns table (user_id uuid, display_name text, first_name text, last_name text, known_as text,
               avatar_path text, invited boolean, declined boolean)
language sql stable
security definer
set search_path = ''
as $$
  select m.user_id, m.display_name, m.first_name, m.last_name, m.known_as, m.avatar_path,
         exists (select 1 from public.pool_invites i where i.pool_id = p_pool and i.invitee = m.user_id and i.answered_at is null),
         exists (select 1 from public.pool_invites i where i.pool_id = p_pool and i.invitee = m.user_id and i.answer = 'declined')
  from public.members m
  where exists (select 1 from public.pool_members me join public.pools p on p.id = me.pool_id
                where me.pool_id = p_pool and me.user_id = auth.uid() and p.school_emis is null)
    and m.user_id <> auth.uid()
    and exists (select 1 from public.pool_members a join public.pool_members b on b.pool_id = a.pool_id
                where a.user_id = auth.uid() and b.user_id = m.user_id)
    and not exists (select 1 from public.pool_members x where x.pool_id = p_pool and x.user_id = m.user_id)
    and not public.blocked_either(auth.uid(), m.user_id)
  order by coalesce(m.first_name, m.display_name), m.last_name
$$;
revoke execute on function public.invite_candidates(bigint) from public, anon;
grant execute on function public.invite_candidates(bigint) to authenticated;

-- Ask one of them. Once someone has said "not now" to a league, they aren't
-- asked about it again, so nobody gets nagged.
create or replace function public.invite_to_pool(p_pool bigint, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, notify
as $$
declare
  pname text;
begin
  if not exists (select 1 from public.invite_candidates(p_pool) c where c.user_id = p_user) then
    raise exception 'You can only invite people you already play with to your own league' using errcode = '42501';
  end if;
  if exists (select 1 from public.pool_invites where pool_id = p_pool and invitee = p_user and answer = 'declined') then
    raise exception 'They said not now to this league' using errcode = 'P0001';
  end if;
  insert into public.pool_invites (pool_id, invitee, inviter) values (p_pool, p_user, auth.uid())
  on conflict (pool_id, invitee) do nothing;
  if not found then return; end if;
  begin
    if exists (select 1 from public.push_subscriptions where user_id = p_user) then
      select name into pname from public.pools where id = p_pool;
      insert into notify.push_outbox (user_id, title, body, url, tag)
      select p_user, coalesce(a.first_name, a.display_name) || ' invited you to ' || pname,
             'Tap to join. Your calls count in every league you''re in.',
             notify.app_link('leagues/'), 'invite-' || p_pool
      from public.members a where a.user_id = auth.uid();
      perform notify.kick_push();
    end if;
  exception when others then
    raise warning 'push for league invite skipped: %', sqlerrm;
  end;
end $$;
revoke execute on function public.invite_to_pool(bigint, uuid) from public, anon;
grant execute on function public.invite_to_pool(bigint, uuid) to authenticated;

-- Invites waiting for you.
create or replace function public.my_pool_invites()
returns table (pool_id bigint, pool_name text, season_name text, inviter_name text, players int, created_at timestamptz)
language sql stable
security definer
set search_path = ''
as $$
  select i.pool_id, p.name, s.name, coalesce(nullif(btrim(concat_ws(' ', a.first_name, a.last_name)), ''), a.display_name),
         (select count(*)::int from public.pool_members pm where pm.pool_id = i.pool_id), i.created_at
  from public.pool_invites i
  join public.pools p on p.id = i.pool_id
  left join public.seasons s on s.id = p.season
  join public.members a on a.user_id = i.inviter
  where i.invitee = auth.uid() and i.answered_at is null
    and not exists (select 1 from public.pool_members x where x.pool_id = i.pool_id and x.user_id = auth.uid())
  order by i.created_at desc
$$;
revoke execute on function public.my_pool_invites() from public, anon;
grant execute on function public.my_pool_invites() to authenticated;

-- Join, or say not now.
create or replace function public.answer_pool_invite(p_pool bigint, p_join boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.pool_invites where pool_id = p_pool and invitee = auth.uid() and answered_at is null) then
    raise exception 'That invite has already been answered' using errcode = 'P0001';
  end if;
  update public.pool_invites set answered_at = now(), answer = case when p_join then 'joined' else 'declined' end
  where pool_id = p_pool and invitee = auth.uid();
  if p_join then
    insert into public.pool_members (pool_id, user_id) values (p_pool, auth.uid()) on conflict do nothing;
  end if;
end $$;
revoke execute on function public.answer_pool_invite(bigint, boolean) from public, anon;
grant execute on function public.answer_pool_invite(bigint, boolean) to authenticated;
