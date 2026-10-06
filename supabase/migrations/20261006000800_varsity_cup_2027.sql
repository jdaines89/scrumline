-- The Varsity Cup 2027: Scrumline's public launch.
--
-- The 2027 fixtures aren't out yet (the tournament starts in February), and
-- our match feed doesn't carry the Varsity Cup at all. Wikipedia does: every
-- season's page lists each match in a {{rugbybox}} (date, time, home, score,
-- away, stadium) under "Round 1" ... "Semi-finals", "Final" headings. So the
-- tournament is loaded now with no matches, and the fixtures and scores come
-- from Wikipedia's "2027 Varsity Cup" page:
--   - every two hours, as for the URC log (raw.request_wiki), so the
--     fixtures arrive by themselves on the day the page lists them;
--   - every 15 minutes on match nights while a finished match has no score.
--
-- How a Wikipedia match becomes ours:
--   - Its id is the season plus the two teams (plus the round for play-offs),
--     never the date or the order on the page, so a moved or re-ordered
--     fixture keeps everyone's calls.
--   - A score counts only once the match has had time to finish (100 minutes
--     after kick-off), so a half-time score typed in live never scores calls.
--   - A full-time score is never taken away by a later edit that blanks it;
--     a corrected score replaces it.
--   - Home and away never swap on a match already loaded (calls are stored
--     home-first); a page that swaps them has its score turned round instead.
--   - Kick-off times on the page are South African time. A match listed
--     without a time locks at 16:45, the earliest regular Varsity Cup slot,
--     until the page gives one.
--   - Only matches under a round, semi-final or final heading count, so the
--     Young Guns and promotion matches lower down the page are left out.
--   - A university the page names that we don't know yet is added as a team
--     with its name as Wikipedia spells it.
--
-- Additive only.

alter table public.seasons add column if not exists fixtures_from text not null default 'feed'
  check (fixtures_from in ('feed', 'wikipedia'));
comment on column public.seasons.fixtures_from is
  'Where fixtures and scores come from: the match feed (TheSportsDB), or the season''s Wikipedia page (wiki_page).';

-- Team names as Wikipedia writes them, for every name a page may use.
create table if not exists public.wiki_team_names (
  wiki_name text primary key,          -- lower case
  team_id   text not null references public.teams(id)
);
alter table public.wiki_team_names enable row level security;
revoke all on public.wiki_team_names from anon, authenticated;

insert into public.competitions (id, name, short_name) values
  ('varsity-cup', 'Varsity Cup', 'Varsity Cup')
on conflict (id) do nothing;

insert into public.seasons (id, name, is_replay, competition_id, feed_season, starts_on, ends_on, wiki_page, fixtures_from) values
  ('varsity-cup-2027', 'Varsity Cup 2027', false, 'varsity-cup', '2027', '2027-02-01', null, '2027 Varsity Cup', 'wikipedia')
on conflict (id) do nothing;

insert into public.teams as t (id, name, display_name, short_name, colour, colour_ink, source) values
  ('wiki-up-tuks',         'UP Tuks',         'UP Tuks',         'TUK', '#0b3b7a', '#ffffff', 'wikipedia'),
  ('wiki-maties',          'Maties',          'Maties',          'MAT', '#6b1d3a', '#ffffff', 'wikipedia'),
  ('wiki-ufs-shimlas',     'UFS Shimlas',     'UFS Shimlas',     'SHI', '#4aa3df', '#0b2545', 'wikipedia'),
  ('wiki-nwu-eagles',      'NWU Eagles',      'NWU Eagles',      'NWU', '#4b2e83', '#ffffff', 'wikipedia'),
  ('wiki-uj',              'UJ',              'UJ',              'UJ',  '#f26522', '#111111', 'wikipedia'),
  ('wiki-uct-ikey-tigers', 'UCT Ikey Tigers', 'UCT Ikey Tigers', 'UCT', '#0a2240', '#ffffff', 'wikipedia'),
  ('wiki-cut-ixias',       'CUT Ixias',       'CUT Ixias',       'CUT', '#1f5fa8', '#ffffff', 'wikipedia'),
  ('wiki-emeris',          'Emeris',          'Emeris',          'EME', '#1a1a1a', '#ffffff', 'wikipedia')
on conflict (id) do update set display_name = excluded.display_name, short_name = excluded.short_name,
  colour = excluded.colour, colour_ink = excluded.colour_ink;

insert into public.wiki_team_names (wiki_name, team_id) values
  ('up tuks', 'wiki-up-tuks'), ('tuks', 'wiki-up-tuks'), ('up-tuks', 'wiki-up-tuks'),
  ('maties', 'wiki-maties'),
  ('ufs shimlas', 'wiki-ufs-shimlas'), ('shimlas', 'wiki-ufs-shimlas'),
  ('nwu eagles', 'wiki-nwu-eagles'), ('nwu pukke', 'wiki-nwu-eagles'), ('nwu', 'wiki-nwu-eagles'),
  ('uj', 'wiki-uj'),
  ('uct ikey tigers', 'wiki-uct-ikey-tigers'), ('uct', 'wiki-uct-ikey-tigers'), ('ikey tigers', 'wiki-uct-ikey-tigers'),
  ('cut ixias', 'wiki-cut-ixias'), ('cut', 'wiki-cut-ixias'),
  ('emeris', 'wiki-emeris'), ('varsity college', 'wiki-emeris')
on conflict (wiki_name) do nothing;

-- Wikitext to plain words: {{Rut|Maties}} -> Maties, [[Page|Label]] -> Label,
-- other templates, references and tags dropped.
create or replace function public.wiki_plain(p text)
returns text
language sql immutable
set search_path = public
as $$
  select nullif(trim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    coalesce(p, ''),
    '<ref[^>]*/>', '', 'g'),
    '<ref.*?</ref>', '', 'g'),
    '\{\{\s*[Rr]u[ts]\s*\|\s*([^}|]+)[^}]*\}\}', '\1', 'g'),
    '\[\[[^]|]*\|([^]]*)\]\]', '\1', 'g'),
    '\[\[([^]]*)\]\]', '\1', 'g'),
    '\{\{[^{}]*\}\}', '', 'g'),
    '<[^>]*>|''''+', '', 'g')), '')
$$;

-- One field of a {{rugbybox}}: the rest of its "| key = ..." line.
create or replace function public.wiki_box_field(p_box text, p_key text)
returns text
language sql immutable
set search_path = public
as $$
  select (regexp_match(p_box, E'\\n\\s*\\|\\s*' || p_key || E'\\s*=([^\\n]*)', 'i'))[1]
$$;

-- Our team for a name on a Wikipedia page, adding it when it's new.
create or replace function public.wiki_team(p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
begin
  select team_id into v_id from public.wiki_team_names where wiki_name = lower(p_name);
  if v_id is not null then return v_id; end if;
  v_id := 'wiki-' || trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'));
  insert into public.teams (id, name, display_name, short_name, source)
  values (v_id, p_name, p_name, coalesce(nullif(upper(left(regexp_replace(p_name, '[^A-Za-z]', '', 'g'), 3)), ''), 'TBC'), 'wikipedia')
  on conflict do nothing;
  if not exists (select 1 from public.teams where id = v_id) then
    select id into v_id from public.teams where name = p_name;
  end if;
  insert into public.wiki_team_names (wiki_name, team_id) values (lower(p_name), v_id) on conflict do nothing;
  return v_id;
end $$;
revoke execute on function public.wiki_team(text) from public, anon, authenticated;

-- One {{rugbybox}} into public.matches. Returns 1 when a match was added or changed.
create or replace function public.core_load_wiki_box(p_season text, p_round int, p_box text, p_raw_id bigint, p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  months constant text[] := array['january', 'february', 'march', 'april', 'may', 'june', 'july',
                                  'august', 'september', 'october', 'november', 'december'];
  dv text := public.wiki_plain(public.wiki_box_field(p_box, 'date'));
  tv text := public.wiki_plain(public.wiki_box_field(p_box, 'time'));
  sv text := public.wiki_plain(public.wiki_box_field(p_box, 'score'));
  raw_date text := public.wiki_box_field(p_box, 'date');
  hn text := public.wiki_plain(public.wiki_box_field(p_box, 'home'));
  an text := public.wiki_plain(public.wiki_box_field(p_box, 'away'));
  venue text := public.wiki_plain(split_part(coalesce(public.wiki_box_field(p_box, 'stadium'), ''), '<br', 1));
  d text[];
  v_day date;
  t text[];
  hh int := 16;
  mi int := 45;
  kick timestamptz;
  sc text[];
  h text;
  a text;
  hs int;
  aws int;
  st text := 'SCHEDULED';
  mid text;
  was_home text;
  n int;
begin
  -- The date: "16 February 2027", "February 16, 2027" or {{dts|2027|2|16}}.
  d := regexp_match(raw_date, '\{\{\s*(?:dts|start date)\s*\|\s*(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})', 'i');
  if d is not null then v_day := make_date(d[1]::int, d[2]::int, d[3]::int);
  else
    d := regexp_match(coalesce(dv, ''), '(\d{1,2})\s+([a-z]+)\s+(\d{4})', 'i');
    if d is not null and array_position(months, lower(d[2])) is not null then
      v_day := make_date(d[3]::int, array_position(months, lower(d[2])), d[1]::int);
    else
      d := regexp_match(coalesce(dv, ''), '([a-z]+)\s+(\d{1,2}),?\s+(\d{4})', 'i');
      if d is not null and array_position(months, lower(d[1])) is not null then
        v_day := make_date(d[3]::int, array_position(months, lower(d[1])), d[2]::int);
      end if;
    end if;
  end if;
  if v_day is null then return 0; end if;

  t := regexp_match(coalesce(tv, ''), '(\d{1,2})\s*[:.h]\s*(\d{2})\s*([ap])?\.?\s*m?', 'i');
  if t is not null then
    hh := t[1]::int; mi := t[2]::int;
    if lower(t[3]) = 'p' and hh < 12 then hh := hh + 12; end if;
    if lower(t[3]) = 'a' and hh = 12 then hh := 0; end if;
    if hh > 23 or mi > 59 then hh := 16; mi := 45; end if;
  end if;
  kick := make_timestamptz(extract(year from v_day)::int, extract(month from v_day)::int, extract(day from v_day)::int, hh, mi, 0, 'Africa/Johannesburg');

  -- Both sides must be real teams, not "Winner SF1" or "TBC".
  if hn is null or an is null or lower(hn) = lower(an)
     or hn ~* '(^tb[acd]$|winner|loser|^[1-4](st|nd|rd|th)\M|semi|place|pool|^v$)'
     or an ~* '(^tb[acd]$|winner|loser|^[1-4](st|nd|rd|th)\M|semi|place|pool|^v$)' then
    return 0;
  end if;
  h := public.wiki_team(hn);
  a := public.wiki_team(an);
  if h = a then return 0; end if;

  -- The score: "50–39", "50-39" or a link around it; only once the match is over.
  sc := regexp_match(regexp_replace(coalesce(sv, ''), '^\s*\[\S+\s+(.*)\]\s*$', '\1'), '^\s*(\d{1,3})\s*[–—-]\s*(\d{1,3})\s*$');
  if sc is not null and kick <= p_now - interval '100 minutes' then
    hs := sc[1]::int; aws := sc[2]::int; st := 'FT';
  elsif coalesce(sv, '') ~* '(postpon|cancel)' then
    st := 'POSTP';
  end if;

  mid := p_season || ':' || case when p_round >= 100 then p_round::text || ':' else '' end || least(h, a) || '~' || greatest(h, a);
  select home_team_id into was_home from public.matches where id = mid;
  if was_home is not null and was_home <> h then
    -- The page swapped home and away: keep ours, turn the score round.
    select a, h, aws, hs into h, a, hs, aws;
  end if;

  insert into public.matches as m (id, season, round, kickoff_at, home_team_id, away_team_id, home_score, away_score, venue, status, source, raw_id)
  values (mid, p_season, p_round, kick, h, a, hs, aws, venue, st, 'wikipedia', p_raw_id)
  on conflict (id) do update set
    round = excluded.round,
    kickoff_at = excluded.kickoff_at,
    venue = coalesce(excluded.venue, m.venue),
    home_score = case when excluded.home_score is null and m.status = 'FT' then m.home_score else excluded.home_score end,
    away_score = case when excluded.away_score is null and m.status = 'FT' then m.away_score else excluded.away_score end,
    status = case when excluded.home_score is null and m.status = 'FT' then 'FT' else excluded.status end,
    raw_id = excluded.raw_id,
    updated_at = now()
  where (m.round, m.kickoff_at, m.venue, m.home_score, m.away_score, m.status)
        is distinct from (excluded.round, excluded.kickoff_at, coalesce(excluded.venue, m.venue),
                          case when excluded.home_score is null and m.status = 'FT' then m.home_score else excluded.home_score end,
                          case when excluded.away_score is null and m.status = 'FT' then m.away_score else excluded.away_score end,
                          case when excluded.home_score is null and m.status = 'FT' then 'FT' else excluded.status end);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.core_load_wiki_box(text, int, text, bigint, timestamptz) from public, anon, authenticated;

-- A season's Wikipedia page into its matches, for seasons whose fixtures come from Wikipedia.
create or replace function public.core_load_wiki_fixtures(p_raw_id bigint, p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public, raw
as $$
declare
  f raw.feed_payloads;
  s public.seasons;
  txt text;
  ln text;
  part text := '';       -- the top-level section we're in
  rnd int;               -- the round the latest heading names; null when it names none
  box text;              -- the {{rugbybox}} being read
  depth int := 0;
  head text;
  n int := 0;
begin
  select * into f from raw.feed_payloads where id = p_raw_id;
  select * into s from public.seasons where id = f.params ->> 'season';
  if s.id is null or s.fixtures_from <> 'wikipedia' then return 0; end if;
  txt := f.payload -> 'parse' ->> 'wikitext';
  if txt is null then return 0; end if;

  for ln in select x from regexp_split_to_table(txt, E'\n') with ordinality as l(x, i) order by i loop
    if box is null and ln ~ '^==+[^=].*==\s*$' then
      head := trim(both ' =' from ln);
      if ln ~ '^==[^=]' then part := head; end if;
      rnd := case
        when part ~* '(young|statistic|honour|reference|promotion|relegation|standing|record|team)' then null
        when head ~* '^(round|week)\s+\d+$' then substring(head from '\d+')::int
        when head ~* '^quarter' then 125
        when head ~* '^semi' then 150
        when head ~* '^(the\s+|grand\s+)?final$' then 200
        else null end;
      continue;
    end if;
    if box is null and ln ~* '^\s*\{\{\s*rugbybox' then box := ''; depth := 0; end if;
    if box is not null then
      box := box || ln || E'\n';
      depth := depth + (length(ln) - length(replace(ln, '{{', ''))) / 2 - (length(ln) - length(replace(ln, '}}', ''))) / 2;
      if depth <= 0 then
        if rnd is not null then n := n + public.core_load_wiki_box(s.id, rnd, box, p_raw_id, p_now); end if;
        box := null;
      end if;
    end if;
  end loop;

  -- The tournament's dates follow its fixtures; the end only once the final is listed.
  update public.seasons se set
    starts_on = x.first_day,
    ends_on = coalesce(x.final_day, se.ends_on)
  from (select min((kickoff_at at time zone 'Africa/Johannesburg')::date) as first_day,
               max((kickoff_at at time zone 'Africa/Johannesburg')::date) filter (where round = 200) as final_day
        from public.matches where season = s.id) x
  where se.id = s.id and x.first_day is not null
    and (se.starts_on, se.ends_on) is distinct from (x.first_day, coalesce(x.final_day, se.ends_on));
  return n;
end $$;
revoke execute on function public.core_load_wiki_fixtures(bigint, timestamptz) from public, anon, authenticated;

-- The collector: as in 20260923002100_wikipedia_bonus_points.sql, plus the
-- fixtures. An unchanged page is still re-read for fixtures, because a score
-- is only taken once its match has had time to finish.
create or replace function raw.collect_responses()
returns table (requests integer, landed integer, matches_changed integer)
language plpgsql
security definer
set search_path = public, raw
as $$
declare
  p record;
  new_id bigint;
  wiki boolean;
begin
  requests := 0; landed := 0; matches_changed := 0;
  for p in
    select q.request_id, q.endpoint, q.params, resp.status_code, resp.content
    from raw.pending_requests q
    join net._http_response resp on resp.id = q.request_id
  loop
    requests := requests + 1;
    wiki := p.endpoint like 'wikipedia:%';
    if p.status_code = 200 and p.content is not null and p.content <> '' then
      insert into raw.feed_payloads (source, endpoint, params, payload)
      values (case when wiki then 'wikipedia' else 'thesportsdb' end, p.endpoint, p.params, p.content::jsonb)
      on conflict do nothing
      returning id into new_id;
      if new_id is not null then
        landed := landed + 1;
        if wiki then
          matches_changed := matches_changed + public.core_load_wiki_fixtures(new_id);
          perform public.core_load_wiki_log(new_id);
        else matches_changed := matches_changed + public.core_load_events(new_id);
        end if;
      elsif wiki then
        select id into new_id from raw.feed_payloads
        where source = 'wikipedia' and endpoint = p.endpoint and params = p.params
          and payload_hash = md5(p.content::jsonb::text)
        order by id desc limit 1;
        if new_id is not null then
          matches_changed := matches_changed + public.core_load_wiki_fixtures(new_id);
        end if;
      end if;
    end if;
    delete from raw.pending_requests where request_id = p.request_id;
  end loop;
  delete from raw.pending_requests where requested_at < now() - interval '1 day';
  return next;
end;
$$;

-- Match nights: re-read the page every 15 minutes while a match that should
-- be over has no score yet.
create or replace function raw.request_wiki_live(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public, raw
as $$
declare
  s record;
  rid bigint;
  n int := 0;
begin
  for s in
    select se.id, se.wiki_page from public.seasons se
    where se.fixtures_from = 'wikipedia' and se.wiki_page is not null and not se.is_replay
      and exists (select 1 from public.matches m
                  where m.season = se.id and m.home_score is null and m.status <> 'POSTP'
                    and m.kickoff_at between p_now - interval '12 hours' and p_now - interval '100 minutes')
      and not exists (select 1 from raw.pending_requests q
                      where q.endpoint = 'wikipedia:parse' and q.params ->> 'season' = se.id)
  loop
    rid := net.http_get(
      url := 'https://en.wikipedia.org/w/api.php',
      params := jsonb_build_object('action', 'parse', 'page', s.wiki_page, 'prop', 'wikitext',
                                   'format', 'json', 'formatversion', '2', 'redirects', '1'),
      headers := '{"User-Agent": "Scrumline/1.0 (private prediction league; match night score check)"}'::jsonb
    );
    insert into raw.pending_requests (request_id, endpoint, params)
    values (rid, 'wikipedia:parse', jsonb_build_object('page', s.wiki_page, 'season', s.id));
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- The match feed leaves Wikipedia seasons alone. As in
-- 20261005000600_knockout_rounds.sql and the live request before it, plus
-- "fixtures_from = 'feed'".
create or replace function raw.request_live(p_daily boolean default false)
returns integer
language plpgsql
security definer
set search_path = public, raw
as $$
declare
  ids text[];
begin
  select array_agg(distinct x) into ids from (
    select m.id as x
    from public.matches m join public.seasons s on s.id = m.season and not s.is_replay and s.fixtures_from = 'feed'
    where m.kickoff_at between now() - interval '6 hours' and now()
       or (m.kickoff_at < now() and m.home_score is null and m.status not in ('POSTP'))
       or (p_daily and m.kickoff_at between now() and now() + interval '7 days')
    union
    select (last_id + k)::text
    from (select max(m.id::bigint) as last_id
          from public.matches m join public.seasons s on s.id = m.season and not s.is_replay and s.fixtures_from = 'feed'
          where m.id ~ '^[0-9]+$' group by s.id) l,
         generate_series(1, 10) k
    where p_daily
  ) q
  where not exists (select 1 from raw.pending_requests p where p.params ->> 'id' = q.x);
  if ids is null then return 0; end if;
  return raw.request_event_ids(ids);
end;
$$;

create or replace function raw.request_knockouts(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public, raw
as $$
declare
  t record;
  rid bigint;
  n integer := 0;
begin
  for t in
    select s.competition_id, s.feed_season, r.round::text as round
    from public.seasons s
    join lateral (select max(m.kickoff_at) as last_ko, max(m.round) filter (where m.round < 125) as last_round
                  from public.matches m where m.season = s.id) l on true
    cross join lateral (select unnest(array[125, 150, 160, 200, l.last_round + 1]) as round) r
    where not s.is_replay and s.fixtures_from = 'feed'
      and l.last_ko between p_now - interval '42 days' and p_now + interval '21 days'
      and r.round is not null
      and not exists (select 1 from raw.pending_requests p
                      where p.endpoint = 'eventsround.php' and p.params ->> 'id' = s.competition_id
                        and p.params ->> 's' = s.feed_season and p.params ->> 'r' = r.round::text)
  loop
    rid := net.http_get(
      url := 'https://www.thesportsdb.com/api/v1/json/3/eventsround.php',
      params := jsonb_build_object('id', t.competition_id, 'r', t.round, 's', t.feed_season)
    );
    insert into raw.pending_requests (request_id, endpoint, params)
    values (rid, 'eventsround.php', jsonb_build_object('id', t.competition_id, 'r', t.round, 's', t.feed_season));
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Leagues are ready before the fixtures: every league playing the URC carries
-- on into the Varsity Cup (same name, same people), and every school league
-- is made for it as for any tournament.
insert into public.pools (season, name, created_by)
select 'varsity-cup-2027', p.name, p.created_by
from public.pools p
where p.season = 'urc-2026-27' and p.school_emis is null
  and not exists (select 1 from public.pools n where n.season = 'varsity-cup-2027' and n.name = p.name and n.created_by = p.created_by);
insert into public.pool_members (pool_id, user_id)
select n.id, pm.user_id
from public.pools p
join public.pool_members pm on pm.pool_id = p.id
join public.pools n on n.season = 'varsity-cup-2027' and n.name = p.name and n.created_by = p.created_by
where p.season = 'urc-2026-27' and p.school_emis is null
on conflict do nothing;
select public.sync_school_pools(u.user_id) from (select distinct user_id from public.member_schools) u;

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('wiki-request-live', '*/15 * * * *', 'select raw.request_wiki_live()');
  end if;
  -- Look for the 2027 page now; the collector lands it within 15 minutes.
  if exists (select 1 from pg_namespace where nspname = 'net') then
    perform raw.request_wiki();
  end if;
end $$;
