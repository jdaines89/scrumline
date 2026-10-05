-- Product analytics: one append-only row per thing a player does, so the
-- 90-day targets (weekly active callers, leagues, alerts) are measured from
-- the database itself rather than guessed.
--
-- public.activity stays as it is: a daily count per player and kind, good for
-- retention. analytics.events is the raw, ordered log underneath funnels
-- ("signed up, then made a team, then called in two rounds") that a daily
-- count can't answer.
--
-- Design:
--   analytics.event_names  the catalogue. Every event name is declared here
--                          with what it means and who writes it ('server' =
--                          a trigger, so it can't be faked or missed; 'app' =
--                          sent by the app through public.log_event).
--   analytics.events       the log. Never updated, never deleted. user_id is
--                          set null if a player is erased, so counts survive
--                          without the person (POPIA).
--   public.gate_metrics()  admin-only summary for the metrics page.
--
-- Adding an event later is one insert into the catalogue plus its trigger or
-- app call: no schema change.
create schema if not exists analytics;
revoke all on schema analytics from public, anon, authenticated;

create table if not exists analytics.event_names (
  name        text primary key check (name ~ '^[a-z][a-z_]{2,39}$'),
  source      text not null check (source in ('server', 'app')),
  description text not null
);

create table if not exists analytics.events (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  user_id uuid references public.members(user_id) on delete set null,
  name    text not null references analytics.event_names(name),
  season  text,
  pool_id bigint,
  props   jsonb not null default '{}' check (jsonb_typeof(props) = 'object' and length(props::text) <= 2000)
);
create index if not exists events_name_at on analytics.events (name, at);
create index if not exists events_user_at on analytics.events (user_id, at);
revoke all on all tables in schema analytics from public, anon, authenticated;

insert into analytics.event_names (name, source, description) values
  ('signed_up',      'server', 'A new member finished signing in for the first time'),
  ('invite_sent',    'server', 'A member invited someone by email'),
  ('team_created',   'server', 'A member made a team (entry) for a tournament'),
  ('league_created', 'server', 'A member started a league (pool), not counting automatic school pools'),
  ('league_joined',  'server', 'A member joined a league (pool)'),
  ('call_made',      'server', 'A member made or changed a scoreline call'),
  ('call_locked',    'server', 'A member locked a call early'),
  ('message_sent',   'server', 'A member posted in a league chat'),
  ('push_on',        'server', 'A phone was signed up for alerts'),
  ('invite_shared',  'app',    'A member tapped share on a league invite'),
  ('recap_shared',   'app',    'A member shared a round recap'),
  ('alerts_shown',   'app',    'The get-alerts card was shown'),
  ('alerts_later',   'app',    'A member tapped Not now on the get-alerts card')
on conflict (name) do update set source = excluded.source, description = excluded.description;

-- The one writer. Server events pass a user; app events use the signed-in one.
create or replace function analytics.emit(p_user uuid, p_name text, p_season text default null,
                                          p_pool bigint default null, p_props jsonb default '{}',
                                          p_at timestamptz default now())
returns void language sql security definer set search_path = '' as $$
  insert into analytics.events (at, user_id, name, season, pool_id, props)
  select p_at, p_user, p_name, p_season, p_pool, coalesce(p_props, '{}')
  where exists (select 1 from public.members where user_id = p_user)
$$;
revoke all on function analytics.emit(uuid, text, text, bigint, jsonb, timestamptz) from public, anon, authenticated;

-- Called by the app. Only 'app' events, at most 200 a day per player.
create or replace function public.log_event(p_name text, p_props jsonb default '{}', p_pool bigint default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from analytics.event_names where name = p_name and source = 'app') then
    raise exception 'Unknown event %', p_name using errcode = 'check_violation';
  end if;
  if (select count(*) from analytics.events where user_id = auth.uid() and at > now() - interval '1 day') >= 200 then
    return;
  end if;
  perform analytics.emit(auth.uid(), p_name, null, p_pool, p_props);
end $$;
revoke all on function public.log_event(text, jsonb, bigint) from public, anon;
grant execute on function public.log_event(text, jsonb, bigint) to authenticated;

-- Server events, written by triggers on the tables players change.
create or replace function analytics.from_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r jsonb := to_jsonb(new);
begin
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
revoke all on function analytics.from_row() from public, anon, authenticated;

create or replace trigger events_signed_up after insert on public.members
  for each row execute function analytics.from_row();
create or replace trigger events_invite after insert on public.invites
  for each row execute function analytics.from_row();
create or replace trigger events_team after insert on public.entries
  for each row execute function analytics.from_row();
create or replace trigger events_league after insert on public.pools
  for each row execute function analytics.from_row();
create or replace trigger events_joined after insert on public.pool_members
  for each row execute function analytics.from_row();
create or replace trigger events_call after insert or update of home_score, away_score on public.predictions
  for each row execute function analytics.from_row();
create or replace trigger events_lock after insert on public.match_locks
  for each row execute function analytics.from_row();
create or replace trigger events_message after insert on public.chat_messages
  for each row execute function analytics.from_row();
create or replace trigger events_push after insert on public.push_subscriptions
  for each row execute function analytics.from_row();

-- History we can recover from the tables, marked backfill so it's never
-- mistaken for live tracking. Calls only keep their last edit, so a call
-- edited three times shows once. Runs once: skipped if events already exist.
do $$ begin
  if exists (select 1 from analytics.events) then return; end if;
  insert into analytics.events (at, user_id, name, season, pool_id, props)
  select at, user_id, name, season, pool_id, '{"backfill": true}'::jsonb from (
    select joined_at at, user_id, 'signed_up' name, null season, null::bigint pool_id from public.members
    union all select created_at, invited_by, 'invite_sent', null, null from public.invites
    union all select created_at, user_id, 'team_created', season, null from public.entries
    union all select created_at, created_by, 'league_created', season, id from public.pools where school_emis is null
    union all select joined_at, user_id, 'league_joined', null, pool_id from public.pool_members
    union all select p.updated_at, e.user_id, 'call_made', e.season, null
      from public.predictions p join public.entries e on e.id = p.entry_id
    union all select l.locked_at, e.user_id, 'call_locked', e.season, null
      from public.match_locks l join public.entries e on e.id = l.entry_id
    union all select created_at, author_id, 'message_sent', null, pool_id from public.chat_messages
    union all select created_at, user_id, 'push_on', null, null from public.push_subscriptions
  ) x
  where exists (select 1 from public.members m where m.user_id = x.user_id)
  order by at;
end $$;

-- The 90-day targets from the implementation plan, measured. Admin only.
--   wac        weekly active callers: players with a call that week (Mon-Sun, SAST)
--   leagues    leagues (not school pools) with 4+ members
--   live       leagues where 4+ members called that week: the plan's
--              "leagues with 4+ active" target
--   alerts     share of players with at least one phone signed up for alerts
--   funnel     of players who joined in the last 60 days: made a team,
--              made a first call, called in 2+ different weeks
create or replace function public.gate_metrics()
returns jsonb language sql stable security definer set search_path = '' as $$
  with wk as (
    select date_trunc('week', now() at time zone 'Africa/Johannesburg')::date as this_week
  ), calls as (
    select e.user_id, date_trunc('week', e.at at time zone 'Africa/Johannesburg')::date as week
    from analytics.events e where e.name = 'call_made' and e.user_id is not null
    group by 1, 2
  ), weeks as (
    select (select this_week from wk) - 7 * g as week from generate_series(0, 11) g
  ), leagues as (
    select p.id,
           (select count(*) from public.pool_members m where m.pool_id = p.id) as members,
           (select count(distinct c.user_id) from calls c join public.pool_members m on m.user_id = c.user_id and m.pool_id = p.id
             where c.week = (select this_week from wk)) as callers
    from public.pools p where p.school_emis is null
  ), recent as (
    select m.user_id from public.members m where m.joined_at > now() - interval '60 days'
  )
  select case when not exists (select 1 from public.members where user_id = auth.uid() and is_admin)
                   and auth.uid() is not null then null else jsonb_build_object(
    'as_of', now(),
    'players', (select count(*) from public.members),
    'wac', (select count(*) from calls where week = (select this_week from wk)),
    'wac_weeks', (select jsonb_agg(jsonb_build_object('week', w.week,
                    'callers', (select count(*) from calls c where c.week = w.week)) order by w.week)
                  from weeks w),
    'leagues', (select count(*) from leagues where members >= 4),
    'live_leagues', (select count(*) from leagues where callers >= 4),
    'alerts', round((select count(distinct user_id) from public.push_subscriptions)::numeric
                    / nullif((select count(*) from public.members), 0), 2),
    'funnel', jsonb_build_object(
      'joined', (select count(*) from recent),
      'team', (select count(*) from recent r where exists (select 1 from public.entries e where e.user_id = r.user_id)),
      'first_call', (select count(*) from recent r where exists (select 1 from calls c where c.user_id = r.user_id)),
      'two_weeks', (select count(*) from recent r where (select count(*) from calls c where c.user_id = r.user_id) >= 2)),
    'targets', jsonb_build_array(
      jsonb_build_object('day', 30, 'date', '2026-11-04', 'wac', 40, 'live_leagues', 8),
      jsonb_build_object('day', 60, 'date', '2026-12-04', 'wac', 80, 'live_leagues', 14),
      jsonb_build_object('day', 90, 'date', '2027-01-03', 'wac', 100, 'live_leagues', 20))
  ) end
$$;
revoke all on function public.gate_metrics() from public, anon;
grant execute on function public.gate_metrics() to authenticated;
