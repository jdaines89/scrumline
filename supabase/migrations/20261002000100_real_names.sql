-- Real names, a school nickname and one team name per person.
--
-- Before: members.display_name did two jobs (a nickname like "Reeves" and,
-- supposedly, a real name), and every tournament asked for a new team name.
-- After, each person has:
--   first_name, last_name  real, for accountability; not unique
--   known_as               optional, what they were called at school
--   team_name              the fun one; one per person, unique, used in every tournament
-- display_name stays as the short name the app already shows in chat, tags,
-- recaps and pushes, but is now worked out from known_as or first_name, and
-- made unique (adding a surname initial, then the surname) so @tags never clash.
-- entries.team_name is kept in step with members.team_name, so every view and
-- query that reads it carries on unchanged.

alter table public.members
  add column first_name text,
  add column last_name text,
  add column known_as text,
  add column team_name text;

alter table public.members
  add constraint members_first_name_length check (first_name is null or length(btrim(first_name)) between 1 and 40),
  add constraint members_last_name_length check (last_name is null or length(btrim(last_name)) between 1 and 40),
  add constraint members_known_as_length check (known_as is null or length(btrim(known_as)) between 1 and 24),
  add constraint members_team_name_length check (team_name is null or length(btrim(team_name)) between 1 and 30);
create unique index members_team_name_unique on public.members (lower(btrim(team_name)));

grant update (first_name, last_name, known_as, team_name) on public.members to authenticated;

-- The short name: known_as, else first name, else whatever it was (a new
-- invitee who hasn't filled in their name yet). Never clashes with anyone else's.
create or replace function public.members_names()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base text;
  cand text;
  n int := 1;
begin
  new.first_name := nullif(btrim(new.first_name), '');
  new.last_name := nullif(btrim(new.last_name), '');
  new.known_as := nullif(btrim(new.known_as), '');
  new.team_name := nullif(btrim(new.team_name), '');
  -- Someone without a real name yet who renames themselves directly keeps the
  -- old rule: a clash is refused by the unique index, not quietly renamed.
  if tg_op = 'UPDATE' and new.first_name is null then
    return new;
  end if;
  base := left(btrim(coalesce(new.known_as, new.first_name, new.display_name)), 24);
  cand := base;
  while exists (select 1 from public.members
                where lower(btrim(display_name)) = lower(cand) and user_id <> new.user_id) loop
    n := n + 1;
    cand := case
      when n = 2 and new.last_name is not null then left(base || ' ' || left(new.last_name, 1), 24)
      when n = 3 and new.last_name is not null then left(base || ' ' || new.last_name, 24)
      else left(base, 20) || ' ' || n
    end;
  end loop;
  new.display_name := cand;
  return new;
end $$;
revoke execute on function public.members_names() from anon, authenticated, public;

-- Runs after members_moderate (triggers fire in name order).
create trigger members_names before insert or update of first_name, last_name, known_as, team_name, display_name
  on public.members for each row execute function public.members_names();

-- An entry's team name is its owner's team name.
create or replace function public.entries_team_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select coalesce(m.team_name, new.team_name) into new.team_name
  from public.members m where m.user_id = new.user_id;
  return new;
end $$;
revoke execute on function public.entries_team_name() from anon, authenticated, public;
create trigger entries_team_from_member before insert or update of team_name
  on public.entries for each row execute function public.entries_team_name();

create or replace function public.members_team_to_entries()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.entries set team_name = new.team_name
  where user_id = new.user_id and team_name is distinct from new.team_name;
  return null;
end $$;
revoke execute on function public.members_team_to_entries() from anon, authenticated, public;
create trigger members_team_to_entries after update of team_name on public.members
  for each row when (new.team_name is not null and new.team_name is distinct from old.team_name)
  execute function public.members_team_to_entries();

-- Names are held to the word list: nicknames and team names to all of it,
-- real names only to hate and threats (a real surname can look like a swear word).
create or replace function moderation.check_names()
returns trigger
language plpgsql
security definer
set search_path = public, moderation
as $$
begin
  if tg_table_name = 'members' then
    if (tg_op = 'INSERT' or new.display_name is distinct from old.display_name)
       and moderation.verdict(new.display_name) is not null then
      if tg_op = 'INSERT' then
        new.display_name := 'Player ' || upper(left(replace(new.user_id::text, '-', ''), 6));
      else
        raise exception 'That name isn''t allowed. Pick another.' using errcode = '22023';
      end if;
    end if;
    if tg_op = 'UPDATE' then
      if (new.first_name is distinct from old.first_name or new.last_name is distinct from old.last_name)
         and moderation.blocks(moderation.verdict(concat_ws(' ', new.first_name, new.last_name)), false) then
        raise exception 'That name isn''t allowed.' using errcode = '22023';
      end if;
      if new.known_as is distinct from old.known_as and moderation.verdict(new.known_as) is not null then
        raise exception 'That nickname isn''t allowed. Pick another.' using errcode = '22023';
      end if;
      if new.team_name is distinct from old.team_name and moderation.verdict(new.team_name) is not null then
        raise exception 'That team name isn''t allowed. Pick another.' using errcode = '22023';
      end if;
    end if;
  elsif tg_table_name = 'entries' then
    if (tg_op = 'INSERT' or new.team_name is distinct from old.team_name)
       and moderation.verdict(new.team_name) is not null then
      raise exception 'That team name isn''t allowed. Pick another.' using errcode = '22023';
    end if;
  elsif tg_table_name = 'pools' then
    -- School and class pools are named after the school by the app.
    if new.school_emis is null and (tg_op = 'INSERT' or new.name is distinct from old.name)
       and moderation.verdict(new.name) is not null then
      raise exception 'That pool name isn''t allowed. Pick another.' using errcode = '22023';
    end if;
  elsif tg_table_name = 'round_prizes' then
    if moderation.verdict(new.sponsor || ' / ' || new.prize) is not null then
      raise exception 'That prize wording isn''t allowed.' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

-- Carry over: each person's most recent team name becomes their one team name
-- (skipped if someone else already has it; they'll pick one in the app), and
-- every entry follows it. Real names are asked for in the app.
do $$
declare
  r record;
begin
  for r in
    select distinct on (e.user_id) e.user_id, left(btrim(e.team_name), 30) as t
    from public.entries e order by e.user_id, e.created_at desc
  loop
    if not exists (select 1 from public.members where lower(btrim(team_name)) = lower(r.t)) then
      update public.members set team_name = r.t where user_id = r.user_id and team_name is null;
    end if;
  end loop;
end $$;
update public.entries e set team_name = m.team_name
from public.members m
where m.user_id = e.user_id and m.team_name is not null and e.team_name is distinct from m.team_name;
