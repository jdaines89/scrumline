-- The Nations Championship, November 2026: a tournament for the URC break.
--
-- The URC stops from 31 October to 4 December. Without rugby to call, the
-- weekly habit dies, so the November tests are loaded as their own
-- tournament: three rounds of six (rounds 4 to 6 of the competition; rounds
-- 1 to 3 were played in July and are left out), 6 to 21 November.
--
-- Same arrangement as the URC: teams listed with the names the feed uses,
-- plus the name we show, a short code and jersey colours; badges arrive with
-- the first fixtures. Fixtures and results come through the usual ingest:
-- the 18 match ids are requested once here, and request_live() follows them.
-- The finals weekend (27 to 29 November) is added once the feed has it.
--
-- Additive only. New: seasons.ends_on, so the app opens on a tournament
-- that is actually running rather than the newest one loaded.

alter table public.seasons add column if not exists ends_on date;

insert into public.competitions (id, name, short_name) values
  ('5852', 'Nations Championship', 'Nations')
on conflict (id) do nothing;

insert into public.seasons (id, name, is_replay, competition_id, feed_season, starts_on, ends_on) values
  ('nations-2026', 'Nations Championship 2026', false, '5852', '2026', '2026-11-06', '2026-11-29')
on conflict (id) do nothing;

insert into public.teams as t (id, name, display_name, short_name, colour, colour_ink, source) values
  ('137124', 'Argentina Rugby',    'Argentina',    'ARG', '#74acdf', '#0d1b2a', 'thesportsdb'),
  ('137125', 'Australia Rugby',    'Australia',    'AUS', '#ffcd00', '#0b3d2e', 'thesportsdb'),
  ('137123', 'England Rugby',      'England',      'ENG', '#f4f4f4', '#c8102e', 'thesportsdb'),
  ('137127', 'Fiji Rugby',         'Fiji',         'FIJ', '#f4f4f4', '#111111', 'thesportsdb'),
  ('137128', 'France Rugby',       'France',       'FRA', '#1d2b5a', '#ffffff', 'thesportsdb'),
  ('137130', 'Ireland Rugby',      'Ireland',      'IRE', '#169b62', '#ffffff', 'thesportsdb'),
  ('137175', 'Italy Rugby',        'Italy',        'ITA', '#0a4ea2', '#ffffff', 'thesportsdb'),
  ('137131', 'Japan Rugby',        'Japan',        'JPN', '#d7182a', '#ffffff', 'thesportsdb'),
  ('137133', 'New Zealand Rugby',  'New Zealand',  'NZL', '#111111', '#ffffff', 'thesportsdb'),
  ('137136', 'Scotland Rugby',     'Scotland',     'SCO', '#1b2a5c', '#ffffff', 'thesportsdb'),
  ('137137', 'South Africa Rugby', 'South Africa', 'RSA', '#00664f', '#ffb81c', 'thesportsdb'),
  ('137141', 'Wales Rugby',        'Wales',        'WAL', '#c8102e', '#ffffff', 'thesportsdb')
on conflict (id) do update set display_name = excluded.display_name, short_name = excluded.short_name,
  colour = excluded.colour, colour_ink = excluded.colour_ink;

-- Every league playing the URC carries on through the break: the same name,
-- the same people. Joining by code works as usual for anyone else.
insert into public.pools (season, name, created_by)
select 'nations-2026', p.name, p.created_by
from public.pools p
where p.season = 'urc-2026-27' and p.school_emis is null
  and not exists (select 1 from public.pools n where n.season = 'nations-2026' and n.name = p.name and n.created_by = p.created_by);
insert into public.pool_members (pool_id, user_id)
select n.id, pm.user_id
from public.pools p
join public.pool_members pm on pm.pool_id = p.id
join public.pools n on n.season = 'nations-2026' and n.name = p.name and n.created_by = p.created_by
where p.season = 'urc-2026-27' and p.school_emis is null
on conflict do nothing;

-- Fetch the November fixtures (rounds 4 to 6) once; the 15-minute collector lands them.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'net') then
    perform raw.request_event_ids(array(select g::text from generate_series(2449603, 2449620) g));
  end if;
end $$;
