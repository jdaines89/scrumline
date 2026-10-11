-- The European cups: both tournaments exist, every league plays them, and
-- the round of 16 reads as such (the URC's round 16 stays a league round).
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;

select pg_temp.check((select count(*) = 2 from public.seasons where id in ('champions-cup-2026-27', 'challenge-cup-2026-27')),
                     'the Champions Cup and Challenge Cup are tournaments');
select pg_temp.check(not exists (select 1 from public.pools l where l.league_id = l.id
                                   and not exists (select 1 from public.pools p where p.league_id = l.id and p.season = 'champions-cup-2026-27')),
                     'every league has a Champions Cup table');

insert into raw.feed_payloads (source, endpoint, params, payload) values ('thesportsdb', 'lookupevent.php', '{"id":"2550790"}',
  '{"events":[{"idEvent":"2550790","idLeague":"4550","strSeason":"2026-2027","intRound":"1","strTimestamp":"2026-10-17T12:00:00",
    "idHomeTeam":"136666","idAwayTeam":"135337","strHomeTeam":"Bulls","strAwayTeam":"Stade Français Paris",
    "strAwayTeamBadge":"https://r2.thesportsdb.com/images/media/team/badge/x.png","strStatus":"Not Started"}]}');
select pg_temp.check(core_load_events((select max(id) from raw.feed_payloads)) = 1, 'a Champions Cup pool match loads');
select pg_temp.check((select display_name = 'Stade Français' and short_name = 'SFP' and badge_url like '%x.png' from public.teams where id = '135337'),
                     'Stade Français shows its usual name, with the badge from the feed');

insert into raw.feed_payloads (source, endpoint, params, payload) values ('thesportsdb', 'eventsround.php', '{"id":"4550","r":"16","s":"2026-2027"}',
  '{"events":[{"idEvent":"2560001","idLeague":"4550","strSeason":"2026-2027","intRound":"16","strTimestamp":"2027-04-03T14:00:00",
    "idHomeTeam":"136670","idAwayTeam":"136666","strHomeTeam":"Stormers","strAwayTeam":"Bulls","strStatus":"Not Started"},
   {"idEvent":"2560002","idLeague":"4446","strSeason":"2026-2027","intRound":"16","strTimestamp":"2027-04-24T14:00:00",
    "idHomeTeam":"136670","idAwayTeam":"136666","strHomeTeam":"Stormers","strAwayTeam":"Bulls","strStatus":"Not Started"}]}');
select core_load_events((select max(id) from raw.feed_payloads));
select pg_temp.check((select round = 116 from public.matches where id = '2560001'), 'a cup round of 16 is stored as 116');
select pg_temp.check((select round = 16 from public.matches where id = '2560002'), 'the URC round 16 stays round 16');
select pg_temp.check(public.round_name(116) = 'Round of 16' and public.round_text(116) = 'the round of 16', 'and reads Round of 16');

do $$ begin raise notice 'EUROPEAN CUP CHECKS PASSED'; end $$;
