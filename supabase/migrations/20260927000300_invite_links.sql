-- Personal invite links.
--
-- Public sign-up stays off. Every player gets their own link
-- (/join/?c=<code>) to share, for example in an old-scholars WhatsApp group.
-- A newcomer opens it, types their email, and the 'join' Edge Function
-- sends them a normal Supabase invite. The invite is recorded against
-- whoever's link it was, so every account traces back to a real person, and
-- a leaked link can only bring in 20 people before it stops working. The
-- owner can reset it at any time, which kills the old one.
--
-- An invite also counts as a schoolmate confirmation: when the inviter and
-- the person they invited have the same school saved, the inviter's vouch
-- is added automatically. Nobody waits to play; confirmation only decides
-- who counts on the national schools table.

-- Codes live in their own table, readable only by their owner, so one
-- player can't pass off another's link as their own.
create table public.invite_codes (
  user_id uuid primary key references public.members(user_id) on delete cascade,
  code    text not null unique check (code ~ '^[a-z0-9]{10}$')
);
alter table public.invite_codes enable row level security;
alter table public.invite_codes force row level security;
revoke all on public.invite_codes from anon, authenticated;

create or replace function public.new_invite_code()
returns text
language sql volatile
set search_path = public
as $$ select lower(substr(md5(random()::text || clock_timestamp()::text), 1, 10)) $$;

create table public.invites (
  invitee_id uuid primary key references auth.users(id) on delete cascade,
  invited_by uuid not null references public.members(user_id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now()
);
create index invites_by on public.invites (invited_by, created_at);

alter table public.invites enable row level security;
alter table public.invites force row level security;
revoke all on public.invites from anon, authenticated;
grant select on public.invites to authenticated;
create policy "your invites" on public.invites for select to authenticated
  using (invited_by = auth.uid() or invitee_id = auth.uid());

-- Who a link belongs to, for the join page's "Justin invited you". Only the
-- first name-like display name is shown, and only for a live code.
create or replace function public.invite_info(p_code text)
returns table (inviter text, open boolean)
language sql stable
security definer
set search_path = public
as $$
  select m.display_name,
         (select count(*) from public.invites i where i.invited_by = m.user_id) < 20
  from public.invite_codes c join public.members m on m.user_id = c.user_id
  where c.code = lower(btrim(p_code))
$$;
revoke execute on function public.invite_info(text) from public;
grant execute on function public.invite_info(text) to anon, authenticated;

-- Your link's code (made the first time you ask) and how many it has
-- brought in.
create or replace function public.my_invite()
returns table (code text, used int, cap int)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_member() then return; end if;
  insert into public.invite_codes (user_id, code) values (auth.uid(), public.new_invite_code())
  on conflict (user_id) do nothing;
  return query
    select c.code, (select count(*)::int from public.invites i where i.invited_by = auth.uid()), 20
    from public.invite_codes c where c.user_id = auth.uid();
end $$;

-- A fresh link; the old one stops working.
create or replace function public.reset_invite_code()
returns text
language sql
security definer
set search_path = public
as $$
  update public.invite_codes set code = public.new_invite_code()
  where user_id = auth.uid()
  returning code
$$;
revoke execute on function public.my_invite(), public.reset_invite_code() from anon, public;
grant execute on function public.my_invite(), public.reset_invite_code() to authenticated;

-- For the 'join' Edge Function only: may this link invite this email?
-- Returns the inviter, or a reason it can't.
create or replace function public.invite_check(p_code text, p_email text)
returns table (inviter uuid, problem text)
language plpgsql stable
security definer
set search_path = public
as $$
declare
  owner uuid;
begin
  select user_id into owner from public.invite_codes where code = lower(btrim(p_code));
  if owner is null then return query select null::uuid, 'That invite link isn''t valid any more. Ask for a new one.'; return; end if;
  if p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(p_email) > 254 then
    return query select null::uuid, 'That doesn''t look like an email address.'; return;
  end if;
  if exists (select 1 from public.members where lower(email) = lower(btrim(p_email))) then
    return query select null::uuid, 'exists'; return;
  end if;
  if (select count(*) from public.invites where invited_by = owner) >= 20 then
    return query select null::uuid, 'This invite link has been used 20 times, which is the limit. Ask for another one.'; return;
  end if;
  if (select count(*) from public.invites where invited_by = owner and created_at > now() - interval '1 hour') >= 10 then
    return query select null::uuid, 'This link has had a lot of sign-ups in the last hour. Try again a bit later.'; return;
  end if;
  return query select owner, null::text;
end $$;

create or replace function public.invite_record(p_invitee uuid, p_inviter uuid, p_email text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.invites (invitee_id, invited_by, email)
  values (p_invitee, p_inviter, lower(btrim(p_email)))
  on conflict (invitee_id) do nothing;
$$;

revoke all on function public.invite_check(text, text), public.invite_record(uuid, uuid, text)
  from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.invite_check(text, text), public.invite_record(uuid, uuid, text) to service_role;
  end if;
end $$;

-- The invite is a vouch: whichever of the two saves the shared school
-- second, the inviter's confirmation lands then.
create or replace function public.invite_vouch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.school_vouches (voucher_id, member_id, stage, emis)
  select i.invited_by, new.user_id, new.stage, new.emis
  from public.invites i
  where i.invitee_id = new.user_id and public.shares_school(i.invited_by, new.user_id, new.stage, new.emis)
  union
  select new.user_id, i.invitee_id, new.stage, new.emis
  from public.invites i
  where i.invited_by = new.user_id and public.shares_school(new.user_id, i.invitee_id, new.stage, new.emis)
  on conflict (voucher_id, member_id, stage) do update set emis = excluded.emis, created_at = now();
  return null;
end $$;
revoke execute on function public.invite_vouch() from public, anon, authenticated;
create trigger member_schools_invite_vouch after insert or update of emis on public.member_schools
  for each row execute function public.invite_vouch();
