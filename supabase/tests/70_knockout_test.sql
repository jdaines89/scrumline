-- Knockout rounds: named properly, and a playoff match from the feed loads.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;

select pg_temp.check(public.round_name(5) = 'Round 5' and public.round_name(125) = 'Quarter-finals'
                     and public.round_name(150) = 'Semi-finals' and public.round_name(200) = 'Final',
                     'rounds read as Round 5, Quarter-finals, Semi-finals, Final');
select pg_temp.check(public.round_text(7) = 'round 7' and public.round_text(200) = 'the final', 'and mid-sentence as round 7, the final');

insert into raw.feed_payloads (source, endpoint, params, payload) values ('thesportsdb', 'eventsround.php', '{"id":"4446","r":"125","s":"2026-2027"}',
  '{"events":[{"idEvent":"2599001","idLeague":"4446","strSeason":"2026-2027","intRound":"125","strTimestamp":"2027-05-29T18:45:00",
    "idHomeTeam":"136670","idAwayTeam":"136666","strHomeTeam":"Stormers","strAwayTeam":"Bulls",
    "intHomeScore":null,"intAwayScore":null,"strVenue":"DHL Stadium","strStatus":"Not Started"}]}');
select pg_temp.check(core_load_events((select max(id) from raw.feed_payloads)) = 1, 'a URC quarter-final from the feed loads');
select pg_temp.check((select round = 125 and season = 'urc-2026-27' from public.matches where id = '2599001'),
                     'it lands in the URC as round 125');

do $$ begin raise notice 'KNOCKOUT CHECKS PASSED'; end $$;
