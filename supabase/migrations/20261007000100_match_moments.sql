-- Match moments. Two times in a match when players already care, made to land:
--   kickoff: each league's chat shows how its players called the game, now that the calls are locked;
--   full time: your points, and where the result leaves you in your league, as a push and on Home.
-- Nothing here suggests a score: it only shows locked calls and finished results.

-- Kickoff reveals, one per league and match. Kept apart from chat_notices, whose kinds are fixed.
create table if not exists public.match_reveals (
  id         bigint generated always as identity primary key,
  pool_id    bigint not null references public.pools(id) on delete cascade,
  match_id   text   not null references public.matches(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (pool_id, match_id)
);

alter table public.match_reveals enable row level security;
revoke all on public.match_reveals from anon;
grant select on public.match_reveals to authenticated;
create policy "league reads its reveals" on public.match_reveals for select to authenticated
  using (public.can_read_chat(pool_id, created_at));

-- Posts a reveal for each league where two or more players called a game that has just kicked off.
-- Only games from the last three hours, so switching this on never floods a chat with old games.
create or replace function public.post_match_reveals()
returns integer
language plpgsql security definer
set search_path = public
as $$
declare n integer;
begin
  insert into public.match_reveals (pool_id, match_id)
  select p.id, m.id
  from public.matches m
  join public.seasons s on s.id = m.season and not s.is_replay
  join public.pools p on p.season = m.season
  where m.kickoff_at <= now() and m.kickoff_at > now() - interval '3 hours'
    and public.pool_has_chat(p.id)
    and (select count(*) from public.pool_members pm
         join public.entries e on e.user_id = pm.user_id and e.season = m.season
         join public.predictions pr on pr.entry_id = e.id and pr.match_id = m.id
         where pm.pool_id = p.id) >= 2
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.post_match_reveals() from public, anon, authenticated;

-- Full time for one player: the finished games they called since p_since (or just p_only),
-- with their points, and in their main league (a mates' league first, then the biggest) where
-- those results left them: rank before and after, and who they passed.
create or replace function public.full_time_moment(p_user uuid, p_since timestamptz, p_only text[] default null)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  with mine as (
    select pp.*, m.home_team_id, m.away_team_id, m.kickoff_at
    from public.prediction_points pp
    join public.entries e on e.id = pp.entry_id and e.user_id = p_user
    join public.matches m on m.id = pp.match_id
    join public.seasons s on s.id = m.season and not s.is_replay
    where m.status in ('FT', 'INTR') and m.kickoff_at >= p_since
      and (p_only is null or pp.match_id = any (p_only))
  ),
  latest as (select season from mine order by kickoff_at desc limit 1),
  fresh as (select * from mine where season = (select season from latest)),
  league as (
    select p.id, coalesce(p.full_name, p.name) as name, coalesce(p.counts_from_round, 0) as from_round,
           (select count(*) from public.pool_members x where x.pool_id = p.id) as size
    from public.pools p
    join public.pool_members pm on pm.pool_id = p.id and pm.user_id = p_user
    where p.season = (select season from latest)
    order by (p.school_emis is null) desc, size desc, p.id
    limit 1
  ),
  totals as (
    select pm.user_id,
           coalesce(sum(pp.total_pts) filter (where pp.round >= l.from_round), 0) as now_pts,
           coalesce(sum(pp.total_pts) filter (where pp.round >= l.from_round
                                                and pp.match_id not in (select match_id from fresh)), 0) as before_pts
    from league l
    join public.pool_members pm on pm.pool_id = l.id
    left join public.entries e on e.user_id = pm.user_id and e.season = (select season from latest)
    left join public.prediction_points pp on pp.entry_id = e.id
    group by pm.user_id
  ),
  me as (select * from totals where user_id = p_user)
  select case when not exists (select 1 from fresh) then null else jsonb_build_object(
    'season', (select season from latest),
    'matches', (select jsonb_agg(jsonb_build_object(
        'match_id', f.match_id, 'home', th.display_name, 'away', ta.display_name,
        'home_score', f.real_home, 'away_score', f.real_away, 'pred_home', f.pred_home, 'pred_away', f.pred_away,
        'pts', f.total_pts, 'exact', f.exact_pts > 0, 'banker', f.is_banker) order by f.kickoff_at, f.match_id)
      from fresh f
      join public.teams th on th.id = f.home_team_id
      join public.teams ta on ta.id = f.away_team_id),
    'league', (select jsonb_build_object(
        'pool_id', l.id, 'name', l.name, 'of', l.size,
        'rank_now', 1 + (select count(*) from totals t where t.now_pts > me.now_pts),
        'rank_before', 1 + (select count(*) from totals t where t.before_pts > me.before_pts),
        'passed', coalesce((select jsonb_agg(mb.display_name order by mb.display_name)
                            from totals t join public.members mb on mb.user_id = t.user_id
                            where t.user_id <> p_user and t.before_pts > me.before_pts and t.now_pts < me.now_pts), '[]'::jsonb))
      from league l, me where l.size >= 2)
  ) end
$$;

revoke all on function public.full_time_moment(uuid, timestamptz, text[]) from public, anon, authenticated;

-- The same for the signed-in player, for Home: results from the last day and a half.
create or replace function public.my_full_time()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select case when public.is_member() then public.full_time_moment(auth.uid(), now() - interval '36 hours') end
$$;

revoke all on function public.my_full_time() from public, anon;
grant execute on function public.my_full_time() to authenticated;

-- Full-time pushes: on by default for anyone with push on their phone; a switch on the profile turns them off.
alter table public.members add column if not exists push_results boolean not null default true;
grant update (push_results) on public.members to authenticated;

create table if not exists notify.full_time_sent (
  user_id  uuid not null,
  match_id text not null,
  sent_at  timestamptz not null default now(),
  primary key (user_id, match_id)
);
revoke all on notify.full_time_sent from public, anon, authenticated;

-- Who is due a full-time push, and for which games: finished in the last 12 hours, called, not pushed yet.
create or replace function notify.due_full_time()
returns table (user_id uuid, match_ids text[])
language sql stable security definer
set search_path = public, notify
as $$
  select e.user_id, array_agg(pp.match_id order by m.kickoff_at, pp.match_id)
  from public.prediction_points pp
  join public.entries e on e.id = pp.entry_id
  join public.matches m on m.id = pp.match_id
  join public.seasons s on s.id = m.season and not s.is_replay
  join public.members mb on mb.user_id = e.user_id and mb.push_results
  where m.status in ('FT', 'INTR') and m.kickoff_at > now() - interval '12 hours'
    and exists (select 1 from public.push_subscriptions ps where ps.user_id = e.user_id)
    and not exists (select 1 from notify.full_time_sent x where x.user_id = e.user_id and x.match_id = pp.match_id)
  group by e.user_id
$$;

-- "Stormers 24–20 Bulls" with the en dash the app uses.
create or replace function notify.ft_score(g jsonb)
returns text language sql immutable as $$
  select (g ->> 'home') || ' ' || (g ->> 'home_score') || '–' || (g ->> 'away_score') || ' ' || (g ->> 'away')
$$;

-- The push for one moment: the result and your points, then where it leaves you.
create or replace function notify.full_time_text(ft jsonb, out title text, out body text)
language plpgsql immutable as $$
declare
  games jsonb := ft -> 'matches';
  g jsonb := games -> 0;
  lg jsonb := ft -> 'league';
  pts integer := (select coalesce(sum((x ->> 'pts')::int), 0) from jsonb_array_elements(games) x);
  now_r integer; before_r integer; passed jsonb; place text;
begin
  if jsonb_array_length(games) = 1 then
    title := 'Full time: ' || notify.ft_score(g);
    body := 'You called ' || (g ->> 'pred_home') || '–' || (g ->> 'pred_away') || ': '
      || case when (g ->> 'exact')::boolean then '+' || pts || ', spot on'
              when pts > 0 then '+' || pts || ' points'
              else 'no points this time' end
      || case when (g ->> 'banker')::boolean and pts > 0 then ', doubled by your Banker.' else '.' end;
  else
    title := 'Full time: ' || jsonb_array_length(games) || ' results in';
    body := '+' || pts || ' from ' || (select string_agg(notify.ft_score(x), ', ') from jsonb_array_elements(games) x) || '.';
  end if;
  if lg is not null then
    now_r := (lg ->> 'rank_now')::int; before_r := (lg ->> 'rank_before')::int; passed := lg -> 'passed';
    place := case now_r % 100 when 11 then 'th' when 12 then 'th' when 13 then 'th'
                  else case now_r % 10 when 1 then 'st' when 2 then 'nd' when 3 then 'rd' else 'th' end end;
    body := body || ' ' || case
      when now_r < before_r then 'Up to ' || now_r || place || ' in ' || (lg ->> 'name')
        || case when jsonb_array_length(passed) = 1 then ', past ' || (passed ->> 0)
                when jsonb_array_length(passed) > 1 then ', past ' || jsonb_array_length(passed) || ' players' else '' end || '.'
      when now_r > before_r then 'Down to ' || now_r || place || ' in ' || (lg ->> 'name') || '.'
      else 'Still ' || now_r || place || ' in ' || (lg ->> 'name') || '.' end;
  end if;
end $$;

-- Queues one push per player per run, covering every game that finished since their last one.
create or replace function notify.send_full_time()
returns integer
language plpgsql security definer
set search_path = public, notify
as $$
declare
  d record;
  ft jsonb;
  msg record;
  n integer := 0;
  app text := (select value from notify.settings where key = 'app_url');
begin
  if not exists (select 1 from notify.settings where key = 'vapid_public_key') then return 0; end if;
  for d in select * from notify.due_full_time() loop
    ft := public.full_time_moment(d.user_id, now() - interval '12 hours', d.match_ids);
    if ft is not null then
      select * into msg from notify.full_time_text(ft);
      insert into notify.push_outbox (user_id, title, body, url, tag)
      values (d.user_id, msg.title, msg.body, app, 'full-time');
      n := n + 1;
    end if;
    insert into notify.full_time_sent (user_id, match_id)
    select d.user_id, x from unnest(d.match_ids) x
    on conflict do nothing;
  end loop;
  if n > 0 then perform notify.kick_push(); end if;
  return n;
end $$;

revoke all on function notify.due_full_time() from public, anon, authenticated;
revoke all on function notify.send_full_time() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.match_reveals;
  end if;
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    -- Calls lock at kickoff, so reveal within five minutes of it.
    perform cron.schedule('match-reveals', '*/5 * * * *', 'select public.post_match_reveals()');
    -- Results are collected at 2, 17, 32 and 47 past; push a few minutes after.
    perform cron.schedule('full-time-pushes', '10-59/15 * * * *', 'select notify.send_full_time()');
  end if;
end $$;
