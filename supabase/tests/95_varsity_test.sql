-- The Varsity Cup: fixtures and scores read from Wikipedia. Checked against
-- the real 2026 page (tests/data/varsity-cup-2026.wiki), loaded as if it were
-- a season of ours.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;

select pg_temp.check((select not is_replay and fixtures_from = 'wikipedia' and wiki_page = '2027 Varsity Cup' and starts_on = '2027-02-01'
                      from public.seasons where id = 'varsity-cup-2027'), 'Varsity Cup 2027 waits for its fixtures from Wikipedia');
select pg_temp.check((select count(*) from public.teams where id like 'wiki-%') = 8, 'eight universities are ready');
select pg_temp.check(exists (select 1 from public.pools where season = 'varsity-cup-2027' and school_emis is not null)
                     or not exists (select 1 from public.pools where season = 'urc-2026-27' and school_emis is not null),
                     'school leagues open for it');

insert into public.seasons (id, name, is_replay, competition_id, feed_season, starts_on, wiki_page, fixtures_from)
values ('vc-test', 'Varsity Cup 2026', false, 'varsity-cup', '2026', '2026-02-01', '2026 Varsity Cup', 'wikipedia');
\set wiki `cat tests/data/varsity-cup-2026.wiki`
insert into raw.feed_payloads (source, endpoint, params, payload)
values ('wikipedia', 'wikipedia:parse', '{"page":"2026 Varsity Cup","season":"vc-test"}',
        jsonb_build_object('parse', jsonb_build_object('wikitext', :'wiki')));

-- Half an hour into the first match: that score is still the half-time kind, so it waits.
select pg_temp.check(public.core_load_wiki_fixtures((select max(id) from raw.feed_payloads), '2026-02-16 15:15+00') = 31,
                     'all 31 matches load: 28 in the rounds, 2 semi-finals, the final');
select pg_temp.check((select home_score is null and status = 'SCHEDULED' from public.matches
                      where id = 'vc-test:wiki-maties~wiki-ufs-shimlas'), 'a match only 30 minutes old has no score yet');

select pg_temp.check(public.core_load_wiki_fixtures((select max(id) from raw.feed_payloads), '2026-06-01') = 31,
                     'once played, every match takes its score');
select pg_temp.check((select home_team_id = 'wiki-ufs-shimlas' and home_score = 50 and away_score = 39 and status = 'FT'
                             and round = 1 and kickoff_at = '2026-02-16 16:45+02' and venue = 'UWC Sport Stadium'
                      from public.matches where id = 'vc-test:wiki-maties~wiki-ufs-shimlas'),
                     'Shimlas 50 Maties 39, round 1, 16:45 on 16 February, at the UWC Sport Stadium');
select pg_temp.check((select count(*) from public.matches where season = 'vc-test' and round between 1 and 7) = 28
                     and (select count(*) from public.matches where season = 'vc-test' and round = 150) = 2,
                     'seven rounds of four and two semi-finals');
select pg_temp.check((select home_team_id = 'wiki-up-tuks' and home_score = 31 and away_score = 3
                      from public.matches where season = 'vc-test' and round = 200), 'the final: Tuks 31 NWU Eagles 3');
select pg_temp.check((select venue = 'Emeris, Durban North' from public.matches
                      where id = 'vc-test:wiki-emeris~wiki-uct-ikey-tigers'), 'a venue written as links reads plainly');
select pg_temp.check(not exists (select 1 from public.teams where id like 'wiki-%' and id not in
                       ('wiki-up-tuks','wiki-maties','wiki-ufs-shimlas','wiki-nwu-eagles','wiki-uj','wiki-uct-ikey-tigers','wiki-cut-ixias','wiki-emeris')),
                     'the Young Guns and promotion matches lower down are left out');
select pg_temp.check((select starts_on = '2026-02-16' and ends_on = '2026-04-13' from public.seasons where id = 'vc-test'),
                     'the tournament''s dates follow its fixtures');
select pg_temp.check((select count(*) = 8 and min(n) = 7 and max(n) = 7 from (
                        select t, count(*) n from public.matches m, unnest(array[home_team_id, away_team_id]) t
                        where season = 'vc-test' and round < 100 group by t) x), 'each university plays seven round matches');

select pg_temp.check(public.core_load_wiki_fixtures((select max(id) from raw.feed_payloads), '2026-06-01') = 0,
                     'reading the same page again changes nothing');

-- An edit that swaps home and away, and one that blanks a played score.
insert into raw.feed_payloads (source, endpoint, params, payload)
values ('wikipedia', 'wikipedia:parse', '{"page":"2026 Varsity Cup","season":"vc-test"}',
        jsonb_build_object('parse', jsonb_build_object('wikitext',
          replace(replace(:'wiki',
            E'| home = {{Rut|UFS Shimlas}}\n| score = 50–39', E'| home = {{Rut|Maties}}\n| score = 39–50'),
            E'| away = {{Rut|Maties}}\n| try1 = [[Kirwin', E'| away = {{Rut|UFS Shimlas}}\n| try1 = [[Kirwin')
          || E'\n')));
select pg_temp.check(position('home = {{Rut|Maties}}' in (select payload -> 'parse' ->> 'wikitext' from raw.feed_payloads order by id desc limit 1)) > 0,
                     '(the edited page really has Maties at home)');
select public.core_load_wiki_fixtures((select max(id) from raw.feed_payloads), '2026-06-01');
select pg_temp.check((select home_team_id = 'wiki-ufs-shimlas' and home_score = 50 and away_score = 39
                      from public.matches where id = 'vc-test:wiki-maties~wiki-ufs-shimlas'),
                     'a page that swaps home and away keeps ours, score turned round');

select public.core_load_wiki_box('vc-test', 1, E'{{rugbybox\n| date = 16 February 2026\n| time = 16:45\n| home = {{Rut|UFS Shimlas}}\n| score = v\n| away = {{Rut|Maties}}\n}}\n', null, '2026-06-01');
select pg_temp.check((select home_score = 50 and away_score = 39 and status = 'FT'
                      from public.matches where id = 'vc-test:wiki-maties~wiki-ufs-shimlas'), 'an edit that blanks a played score never takes it away');

-- Fixtures written before the season: no score, a time in pm, a date the other way round, a "winner of" final.
insert into public.seasons (id, name, is_replay, competition_id, feed_season, starts_on, wiki_page, fixtures_from)
values ('vc-test-b', 'Varsity Cup 2027 (test)', false, 'varsity-cup', '2027-test', '2027-02-01', '2027 Varsity Cup', 'wikipedia');
select pg_temp.check(public.core_load_wiki_box('vc-test-b', 2, E'{{rugbybox\n| date = {{dts|2027|2|15}}\n| time = 7:00 pm\n| home = [[UJ]]\n| score = v\n| away = {{Rut|NWU Pukke}}\n}}\n', null, '2026-06-01') = 1, 'a fixture before the season loads');
select pg_temp.check((select kickoff_at = '2027-02-15 19:00+02' and status = 'SCHEDULED' and home_score is null
                          from public.matches where id = 'vc-test-b:wiki-nwu-eagles~wiki-uj'),
                     'a future fixture at 7:00 pm on {{dts|2027|2|15}}, NWU Pukke read as NWU Eagles');
select pg_temp.check(public.core_load_wiki_box('vc-test-b', 200, E'{{rugbybox\n| date = April 12, 2027\n| home = Winner SF1\n| score = v\n| away = Winner SF2\n}}\n', null) = 0,
                     'a final between "Winner SF1" and "Winner SF2" waits for real teams');
select pg_temp.check(public.core_load_wiki_box('vc-test-b', 3, E'{{rugbybox\n| date = March 1, 2027\n| home = {{Rut|Wits}}\n| score = v\n| away = {{Rut|Maties}}\n}}\n', null) = 1, 'a fixture with a new university loads');
select pg_temp.check((select display_name = 'Wits' and short_name = 'WIT' from public.teams where id = 'wiki-wits')
                     and (select kickoff_at = '2027-03-01 16:45+02' from public.matches where id = 'vc-test-b:wiki-maties~wiki-wits'),
                     'a university we didn''t know is added; no time given locks at 16:45');

-- The match feed leaves Wikipedia seasons alone.
select pg_temp.check(position('fixtures_from = ''feed''' in pg_get_functiondef('raw.request_live(boolean)'::regprocedure)) > 0
                     and position('fixtures_from = ''feed''' in pg_get_functiondef('raw.request_knockouts(timestamptz)'::regprocedure)) > 0,
                     'the match feed never asks about Varsity Cup matches');

do $$ begin raise notice 'VARSITY CHECKS PASSED'; end $$;
