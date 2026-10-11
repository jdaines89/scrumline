-- The European cups, 2026-27: the Investec Champions Cup and the EPCR
-- Challenge Cup, two new tournaments every league plays automatically.
--
-- Both are on TheSportsDB's free key (Champions Cup league 4550, Challenge
-- Cup 5418, season '2026-2027'). Pool stage: four rounds (16-18 Oct,
-- 11-13 Dec, 8-10 Jan, 15-17 Jan); knockouts from April, finals in May.
-- The Bulls, Stormers and Lions are in the Champions Cup; the Sharks and
-- Cheetahs in the Challenge Cup.
--
-- Same arrangement as the URC: fixtures and results come through the usual
-- ingest. The pool matches have ids in sequence (2550789-2550836 and
-- 2551051-2551086); round 1 is requested here and request_live() does the rest.
-- Badges arrive with the first fixtures (the official-badges setting
-- decides whether they show). Teams new to Scrumline get the name fans use,
-- a short code and a jersey colour here; anything else is added by the
-- ingest with the feed's name.
--
-- Knockouts: TheSportsDB numbers the round of 16 as round 16, which would
-- read "Round 16". Cup matches in round 16 are stored as 116, named
-- "Round of 16", and request_knockouts() now also asks for round 16.
--
-- Additive only.

insert into public.competitions (id, name, short_name) values
  ('4550', 'Investec Champions Cup', 'Champions Cup'),
  ('5418', 'EPCR Challenge Cup', 'Challenge Cup')
on conflict (id) do nothing;

-- Teams new to Scrumline (the URC sides, Bulls, Stormers, Lions, Sharks and
-- Cheetahs are already here and stay as they are).
insert into public.teams as t (id, name, display_name, short_name, colour, colour_ink, source) values
  ('135201', 'Gloucester',                'Gloucester',          'GLO', '#c8102e', '#ffffff', 'thesportsdb'),
  ('135329', 'Union Bordeaux Bègles',     'Bordeaux Bègles',     'UBB', '#5b1a32', '#ffffff', 'thesportsdb'),
  ('135337', 'Stade Français Paris',      'Stade Français',      'SFP', '#e5007d', '#ffffff', 'thesportsdb'),
  ('135207', 'Sale Sharks',               'Sale Sharks',         'SAL', '#0b2a5b', '#ffffff', 'thesportsdb'),
  ('135332', 'ASM Clermont Auvergne',     'Clermont Auvergne',   'CLE', '#ffcc00', '#0b2a5b', 'thesportsdb'),
  ('135740', 'Bristol Bears',             'Bristol Bears',       'BRI', '#1c3a6e', '#ffffff', 'thesportsdb'),
  ('137384', 'Section Paloise',           'Pau',                 'PAU', '#00843d', '#ffffff', 'thesportsdb'),
  ('135206', 'Northampton Saints',        'Northampton Saints',  'NOR', '#0b4f3a', '#e6c35c', 'thesportsdb'),
  ('135339', 'Stade Toulousain',          'Toulouse',            'TOU', '#d71920', '#ffffff', 'thesportsdb'),
  ('135180', 'Leicester Tigers',          'Leicester Tigers',    'TIG', '#00704a', '#ffffff', 'thesportsdb'),
  ('135334', 'Montpellier Hérault Rugby', 'Montpellier',         'MON', '#0c2b5a', '#ffffff', 'thesportsdb'),
  ('135199', 'Bath Rugby',                'Bath',                'BAT', '#0a1f44', '#ffffff', 'thesportsdb'),
  ('135200', 'Exeter Chiefs',             'Exeter Chiefs',       'EXE', '#111111', '#ffffff', 'thesportsdb'),
  ('135340', 'Stade Rochelais',           'La Rochelle',         'LAR', '#ffd100', '#111111', 'thesportsdb'),
  ('137386', 'USA Perpignan',             'Perpignan',           'PER', '#c8102e', '#ffd100', 'thesportsdb'),
  ('135338', 'RC Toulonnais',             'Toulon',              'TLN', '#b5121b', '#ffffff', 'thesportsdb'),
  ('147880', 'Black Lion',                'Black Lion',          'BLK', '#111111', '#ffffff', 'thesportsdb'),
  ('135341', 'Lyon OU',                   'Lyon',                'LYO', '#e4002b', '#ffffff', 'thesportsdb'),
  ('135202', 'Harlequins',                'Harlequins',          'HAR', '#4b2c6f', '#ffffff', 'thesportsdb'),
  ('135328', 'Aviron Bayonnais',          'Bayonne',             'BAY', '#7fb2e5', '#0b1f3a', 'thesportsdb'),
  ('135205', 'Newcastle Red Bulls',       'Newcastle Red Bulls', 'NEW', '#d0021b', '#ffffff', 'thesportsdb'),
  ('135331', 'Castres Olympique',         'Castres',             'CAS', '#1f3a93', '#ffffff', 'thesportsdb'),
  ('135208', 'Saracens',                  'Saracens',            'SAR', '#111111', '#e4002b', 'thesportsdb'),
  ('135336', 'Racing Métro 92',           'Racing 92',           'RAC', '#6cace4', '#0b1f3a', 'thesportsdb')
on conflict (id) do nothing;

-- The round of 16, stored as 116 for the cups only (the URC has a real round 16).
create or replace function public.cup_round_of_16()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.round = 16 and exists (select 1 from public.seasons s
                                where s.id = new.season and s.competition_id in ('4550', '5418')) then
    new.round := 116;
  end if;
  return new;
end $$;
create or replace trigger matches_cup_round_of_16 before insert or update of round on public.matches
  for each row execute function public.cup_round_of_16();

create or replace function public.round_name(p_round integer)
returns text language sql immutable set search_path = '' as $$
  select case p_round when 116 then 'Round of 16' when 125 then 'Quarter-finals' when 150 then 'Semi-finals'
                      when 160 then 'Third-place play-off' when 200 then 'Final'
                      else 'Round ' || p_round end
$$;
create or replace function public.round_text(p_round integer)
returns text language sql immutable set search_path = '' as $$
  select case p_round when 116 then 'the round of 16' when 125 then 'the quarter-finals' when 150 then 'the semi-finals'
                      when 160 then 'the third-place play-off' when 200 then 'the final'
                      else 'round ' || p_round end
$$;

-- As in 20261006000800_varsity_cup_2027.sql, plus round 16. For the URC that
-- is a league round, which loads the same way, so asking is harmless. The
-- cups wait about eleven weeks between the pool stage and the round of 16, so
-- for them the job keeps asking for up to 100 days after the last match.
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
    cross join lateral (select unnest(array[16, 125, 150, 160, 200, l.last_round + 1]) as round) r
    where not s.is_replay and s.fixtures_from = 'feed'
      and l.last_ko between p_now - case when s.competition_id in ('4550', '5418') then interval '100 days'
                                         else interval '42 days' end
                        and p_now + interval '21 days'
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

-- The seasons. Inserting them gives every league a table in each (the
-- seasons_spread trigger); school leagues are made as for the Varsity Cup.
insert into public.seasons (id, name, is_replay, competition_id, feed_season, starts_on, ends_on) values
  ('champions-cup-2026-27', 'Champions Cup 2026-27', false, '4550', '2026-2027', '2026-10-16', '2027-05-22'),
  ('challenge-cup-2026-27', 'Challenge Cup 2026-27', false, '5418', '2026-2027', '2026-10-16', '2027-05-22')
on conflict (id) do nothing;

-- (Only adds: the same pools and memberships sync_school_pools makes, for these tournaments.)
insert into public.pools (season, name, created_by, school_emis, school_stage)
select distinct on (s.id, ms.emis, ms.stage) s.id, left(sc.name, 40), ms.user_id, ms.emis, ms.stage
from public.member_schools ms join public.schools sc on sc.emis = ms.emis
cross join (values ('champions-cup-2026-27'), ('challenge-cup-2026-27')) s(id)
order by s.id, ms.emis, ms.stage, ms.user_id
on conflict (season, school_emis, school_stage) where school_emis is not null and school_year is null do nothing;
insert into public.pools (season, name, created_by, school_emis, school_stage, school_year)
select distinct on (s.id, ms.emis, ms.stage, ms.last_year) s.id, public.class_pool_name(sc.name, ms.last_year), ms.user_id, ms.emis, ms.stage, ms.last_year
from public.member_schools ms join public.schools sc on sc.emis = ms.emis
cross join (values ('champions-cup-2026-27'), ('challenge-cup-2026-27')) s(id)
where ms.last_year is not null
order by s.id, ms.emis, ms.stage, ms.last_year, ms.user_id
on conflict (season, school_emis, school_stage, school_year) where school_year is not null do nothing;
insert into public.pool_members (pool_id, user_id)
select p.id, ms.user_id
from public.member_schools ms
join public.pools p on p.season in ('champions-cup-2026-27', 'challenge-cup-2026-27')
                   and p.school_emis = ms.emis and p.school_stage = ms.stage
                   and (p.school_year is null or p.school_year = ms.last_year)
on conflict do nothing;

-- Fetch round 1 now (21 matches, under the free key's rate limit); the
-- 15-minute collector lands them. The daily job's "next ten ids" then walks
-- through rounds 2 to 4 in a few days.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'net') then
    perform raw.request_event_ids(array(select g::text from generate_series(2550789, 2550800) g));
    perform raw.request_event_ids(array(select g::text from generate_series(2551051, 2551059) g));
  end if;
end $$;
