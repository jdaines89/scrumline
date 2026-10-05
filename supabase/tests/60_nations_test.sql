-- The Nations Championship: loaded beside the URC, fed by the same ingest.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;

select pg_temp.check((select not is_replay and starts_on = '2026-11-06' and ends_on = '2026-11-29'
                      from public.seasons where id = 'nations-2026'), 'the tournament runs 6 to 29 November');
select pg_temp.check((select count(*) from public.teams where id in ('137124','137125','137123','137127','137128','137130',
                      '137175','137131','137133','137136','137137','137141') and display_name !~ ' Rugby$') = 12,
                     'twelve teams show as plain country names');

-- A feed event for this league files into this tournament, not the Currie Cup (same feed season, "2026").
insert into raw.feed_payloads (source, endpoint, params, payload) values ('thesportsdb', 'lookupevent.php', '{"id":"2449606"}',
  '{"events":[{"idEvent":"2449606","idLeague":"5852","strSeason":"2026","intRound":"4","strTimestamp":"2026-11-07T11:40:00",
    "idHomeTeam":"137175","idAwayTeam":"137137","strHomeTeam":"Italy Rugby","strAwayTeam":"South Africa Rugby",
    "intHomeScore":null,"intAwayScore":null,"strVenue":"Allianz Stadium Turin","strStatus":"Not Started",
    "strHomeTeamBadge":"https://example.test/ita.png","strAwayTeamBadge":"https://example.test/rsa.png"}]}');
select pg_temp.check(core_load_events((select max(id) from raw.feed_payloads)) = 1, 'a Nations Championship match loads');
select pg_temp.check((select season = 'nations-2026' and round = 4 and status = 'SCHEDULED' from public.matches where id = '2449606'),
                     'it lands in round 4 of the Nations Championship');
select pg_temp.check((select display_name = 'South Africa' and badge_url is not null from public.teams where id = '137137'),
                     'the badge arrives and the chosen name stays');
select pg_temp.check(exists (select 1 from public.pools where season = 'nations-2026' and school_emis is not null)
                     or not exists (select 1 from public.pools where season = 'urc-2026-27' and school_emis is not null),
                     'school pools open for the new tournament');

do $$ begin raise notice 'NATIONS CHECKS PASSED'; end $$;
