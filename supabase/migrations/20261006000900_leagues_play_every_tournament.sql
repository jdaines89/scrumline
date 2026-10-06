-- A league is a group of people that plays every tournament.
--
-- Until now a league belonged to one tournament, and carrying it into a new
-- one meant copying it by hand. Now each tournament's table for a league is
-- one of a family sharing pools.league_id (the id of the league's first
-- table, which also holds its chat and picture):
--   - a new league gets a table in every tournament that's on or coming up;
--   - a new tournament gets a table for every league;
--   - joining any of a league's tables (by code or invite) joins them all.
-- Points stay per tournament: each table is scored exactly as before.
-- Practice replays and school leagues are left as they are (school leagues
-- already come with every tournament).
--
-- The automatic copies aren't counted as leagues started or joins in the
-- analytics, and the "leagues with 4+ players" numbers count each league once.
--
-- Additive only.

alter table public.pools add column if not exists league_id bigint references public.pools(id);
create index if not exists pools_league on public.pools (league_id);
comment on column public.pools.league_id is
  'The league this table belongs to: the id of its first table (which holds the chat and picture). Null for school leagues and practice replays.';

-- Today's leagues: the same name started by the same person is one league,
-- its first table the one that holds the chat.
update public.pools p set league_id = g.root
from (select p2.id, min(p2.id) over (partition by p2.name, p2.created_by) as root
      from public.pools p2 join public.seasons s on s.id = p2.season
      where p2.school_emis is null and not s.is_replay) g
where p.id = g.id and p.league_id is null;

-- Whether this transaction is spreading a league by itself (so nothing counts it as a person's action).
create or replace function public.league_spreading()
returns boolean language sql stable as $$
  select coalesce(current_setting('scrumline.spreading', true), '') = 'on'
$$;

-- Give a league a table in every tournament that's on or coming up, and put
-- everyone in any of its tables into all of them.
create or replace function public.spread_league(p_league bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  root public.pools;
  was text := coalesce(current_setting('scrumline.spreading', true), '');
begin
  select * into root from public.pools where id = p_league and league_id = id;
  if root.id is null then return; end if;
  perform set_config('scrumline.spreading', 'on', true);

  insert into public.pools (season, name, created_by, league_id)
  select s.id, root.name, root.created_by, root.id
  from public.seasons s
  where not s.is_replay and (s.ends_on is null or s.ends_on >= current_date)
    and not exists (select 1 from public.pools p where p.season = s.id and p.league_id = root.id);

  insert into public.pool_members (pool_id, user_id)
  select t.id, m.user_id
  from (select distinct pm.user_id from public.pool_members pm
        join public.pools p on p.id = pm.pool_id where p.league_id = root.id) m
  cross join (select id from public.pools where league_id = root.id) t
  on conflict do nothing;

  perform set_config('scrumline.spreading', was, true);
end $$;
revoke execute on function public.spread_league(bigint) from public, anon, authenticated;

-- A new mates' league is its own family's first table.
create or replace function public.pool_league_id()
returns trigger
language plpgsql
as $$
begin
  if new.school_emis is null and new.league_id is null
     and not exists (select 1 from public.seasons where id = new.season and is_replay) then
    new.league_id := new.id;
  end if;
  return new;
end $$;

create or replace function public.pool_spread()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.league_id = new.id and not public.league_spreading() then
    perform public.spread_league(new.id);
  end if;
  return null;
end $$;

-- Joining one of a league's tables joins them all.
create or replace function public.pool_member_spread()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  lid bigint;
  was text := coalesce(current_setting('scrumline.spreading', true), '');
begin
  if public.league_spreading() then return null; end if;
  select league_id into lid from public.pools where id = new.pool_id;
  if lid is null then return null; end if;
  perform set_config('scrumline.spreading', 'on', true);
  insert into public.pool_members (pool_id, user_id)
  select p.id, new.user_id from public.pools p where p.league_id = lid and p.id <> new.pool_id
  on conflict do nothing;
  perform set_config('scrumline.spreading', was, true);
  return null;
end $$;

-- A new tournament: every league gets its table.
create or replace function public.season_spread()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  l bigint;
begin
  if new.is_replay then return null; end if;
  for l in select id from public.pools where league_id = id loop
    perform public.spread_league(l);
  end loop;
  return null;
end $$;

create or replace trigger pools_league_id before insert on public.pools
  for each row execute function public.pool_league_id();
create or replace trigger pools_spread after insert on public.pools
  for each row execute function public.pool_spread();
create or replace trigger pool_members_spread after insert on public.pool_members
  for each row execute function public.pool_member_spread();
create or replace trigger seasons_spread after insert on public.seasons
  for each row execute function public.season_spread();

-- Analytics and activity: as in 20261005000200_analytics_events.sql and the
-- retention metrics, but a league's automatic tables and joins aren't a
-- person starting or joining anything.
create or replace function analytics.from_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare r jsonb := to_jsonb(new);
begin
  if public.league_spreading() and tg_table_name in ('pools', 'pool_members') then return null; end if;
  case tg_table_name
    when 'members' then
      perform analytics.emit(new.user_id, 'signed_up');
    when 'invites' then
      perform analytics.emit(new.invited_by, 'invite_sent');
    when 'entries' then
      perform analytics.emit(new.user_id, 'team_created', new.season);
    when 'pools' then
      if r->>'school_emis' is null then
        perform analytics.emit(new.created_by, 'league_created', new.season, new.id);
      end if;
    when 'pool_members' then
      perform analytics.emit(new.user_id, 'league_joined', null, new.pool_id);
    when 'predictions' then
      perform analytics.emit(e.user_id, 'call_made', e.season, null,
                             jsonb_build_object('match', new.match_id, 'edit', tg_op = 'UPDATE'))
        from public.entries e where e.id = new.entry_id;
    when 'match_locks' then
      perform analytics.emit(e.user_id, 'call_locked', e.season, null, jsonb_build_object('match', new.match_id))
        from public.entries e where e.id = new.entry_id;
    when 'chat_messages' then
      perform analytics.emit(new.author_id, 'message_sent', null, (r->>'pool_id')::bigint);
    when 'push_subscriptions' then
      perform analytics.emit(new.user_id, 'push_on');
  end case;
  return null;
end $$;

create or replace function public.activity_from_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.league_spreading() and tg_table_name = 'pool_members' then return null; end if;
  case tg_table_name
    when 'predictions' then
      perform public.log_activity((select user_id from public.entries where id = new.entry_id), 'call');
    when 'match_locks' then
      perform public.log_activity((select user_id from public.entries where id = new.entry_id), 'lock');
    when 'chat_messages' then
      perform public.log_activity(new.author_id, 'message');
    when 'chat_reactions' then
      perform public.log_activity(new.user_id, 'reaction');
    when 'pool_members' then
      perform public.log_activity(new.user_id, 'join');
  end case;
  return null;
end $$;

-- "Leagues with 4+ players" counts each league once, not once per tournament.
do $$
declare
  def text;
  fixed text;
begin
  def := pg_get_functiondef('public.gate_metrics()'::regprocedure);
  fixed := regexp_replace(def, '(from public\.pools p where p\.school_emis is null)(\s+\), recent)',
                          '\1 and (p.league_id is null or p.league_id = p.id)\2');
  if fixed <> def then execute fixed; else raise notice 'gate_metrics: leagues line not found, left as it was'; end if;

  def := pg_get_functiondef('public.sponsor_pack()'::regprocedure);
  fixed := replace(def, '''leagues'', (select count(*) from public.pools p where p.school_emis is null',
                        '''leagues'', (select count(*) from public.pools p where p.school_emis is null and (p.league_id is null or p.league_id = p.id)');
  if fixed <> def then execute fixed; else raise notice 'sponsor_pack: leagues line not found, left as it was'; end if;
end $$;

-- Today's leagues into every tournament that's on or coming up (Rassie's
-- Roulette into the Varsity Cup and the Nations Championship, for one).
select public.spread_league(id) from public.pools where league_id = id;
