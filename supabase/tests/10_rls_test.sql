-- Behaviour tests for the league: run after the migrations and seed.
-- Every check raises on failure, so a clean run prints "ALL CHECKS PASSED".
\set ON_ERROR_STOP on

-- Two invited members and one stranger who was never invited.
insert into auth.users (id, email, invited_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'justin@example.com', now(), '{"display_name":"Justin"}'),
  ('00000000-0000-0000-0000-00000000000b', 'andy@example.com', now(), '{}'),
  ('00000000-0000-0000-0000-0000000000ff', 'stranger@example.com', null, '{}');  -- signed up without an invite
select 'members created by the invite trigger: ' || count(*) from public.members;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;

create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  if uid is null then
    perform set_config('role', 'anon', false);
    perform set_config('request.jwt.claim.sub', '', false);
  else
    perform set_config('role', 'authenticated', false);
    perform set_config('request.jwt.claim.sub', uid, false);
  end if;
end $$;

-- Data landed
select pg_temp.check((select count(*) from public.matches) = 28, 'seed: 28 matches');
select pg_temp.check((select count(*) from public.teams t where badge_url is not null and exists (select 1 from public.matches m where m.season = '2026' and t.id in (m.home_team_id, m.away_team_id))) = 8, 'seed: 8 Currie Cup badges');

-- The log matches the published 2026 table exactly
select pg_temp.check(
  (select string_agg(t.short_name || ':' || s.log_points, ' ' order by s.position)
     from public.standings s join public.teams t on t.id = s.team_id where s.season = '2026')
  = 'GRQ:31 CHE:27 PUM:22 LIO:20 SHK:18 BOL:16 WP:16 BUL:6',
  'standings match the published 2026 table');

-- Not signed in: sees nothing
select pg_temp.as_user(null);
do $$ begin
  perform 1 from public.matches limit 1;
  raise exception 'FAILED: anon could read matches';
exception when insufficient_privilege then raise notice 'ok: anon cannot read matches';
end $$;
reset role;

select pg_temp.check((select count(*) from public.members) = 2, 'only invited accounts become members');

-- Signed in but never invited: sees nothing, can't make an entry
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ff');
select pg_temp.check((select count(*) from public.matches) = 0, 'uninvited user sees no matches');
do $$ begin
  insert into public.entries (season, team_name) values ('2026', 'Gatecrashers');
  raise exception 'FAILED: uninvited user made an entry';
exception when insufficient_privilege then raise notice 'ok: uninvited user cannot make an entry';
end $$;
reset role;

-- Justin: reads the league, makes an entry, picks four unions
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.matches) = 28, 'member sees all matches');
insert into public.entries (season, team_name) values ('2026', 'Daines XV');
insert into public.pools (season, name) values ('2026', 'Test pool');
select pg_temp.check((select count(*) from public.pool_members) = 1, 'starting a pool puts you in it');
insert into public.pool_picks (entry_id, season, round, team_id, is_captain)
select e.id, '2026', 1, t, t = '142073' from public.entries e,
  unnest(array['142073','142075','142067','142063']) t where e.team_name = 'Daines XV';
do $$ begin
  insert into public.pool_picks (entry_id, season, round, team_id)
  select id, '2026', 1, '142072' from public.entries where team_name = 'Daines XV';
  raise exception 'FAILED: fifth pick allowed';
exception when raise_exception then raise notice 'ok: a fifth pick is refused';
end $$;
insert into public.predictions (entry_id, match_id, home_score, away_score)
select id, '2498543', 24, 26 from public.entries where team_name = 'Daines XV';
insert into public.predictions (entry_id, match_id, home_score, away_score, is_banker)
select id, '2498544', 20, 10, true from public.entries where team_name = 'Daines XV';
update public.predictions set is_banker = true where match_id = '2498543';
select pg_temp.check((select string_agg(match_id, ',') from public.predictions where is_banker) = '2498543',
  'backing a second match moves the Banker, one a round');
select pg_temp.check((select count(*) from public.pool_pick_scores) = 0, 'no score shows before the round is locked in');
insert into public.round_locks (entry_id, season, round)
select id, '2026', 1 from public.entries where team_name = 'Daines XV';
select pg_temp.check((select count(*) from public.pool_pick_scores) = 4, 'scores show once locked in');
do $$ begin
  delete from public.pool_picks where team_id = '142073';
  raise exception 'FAILED: changed a locked round';
exception when raise_exception then raise notice 'ok: a locked round cannot change';
end $$;
select pg_temp.check((select count(*) from public.round_locks) = 1, 'lock row exists');
do $$ begin
  delete from public.round_locks;
  raise exception 'FAILED: undid a lock';
exception when insufficient_privilege then raise notice 'ok: a lock cannot be undone';
end $$;
do $$ begin
  update public.matches set home_score = 99;
  raise exception 'FAILED: member edited a result';
exception when insufficient_privilege then raise notice 'ok: members cannot edit results';
end $$;
reset role;

select join_code as code, id as poolid from public.pools where name = 'Test pool' \gset

-- Andy: joins with the code, sees Justin on the pool leaderboard, cannot touch his picks
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.pools) = 0, 'a pool is invisible until you join it');
do $$ begin
  perform public.join_pool('NOPE00');
  raise exception 'FAILED: joined with a wrong code';
exception when raise_exception then raise notice 'ok: a wrong code joins nothing';
end $$;
select public.join_pool(lower(:'code'));
select pg_temp.check((select count(*) from public.pool_leaderboard where team_name = 'Daines XV') = 1, 'Andy sees Justin on the pool leaderboard');
select pg_temp.check((select count(*) from public.predictions) = 2, 'Andy sees Justin''s calls once his round is locked');
delete from public.pool_picks;
update public.predictions set home_score = 0;
reset role;
select pg_temp.check((select count(*) from public.pool_picks) = 4, 'Andy could not delete Justin''s picks');
select pg_temp.check((select home_score from public.predictions where match_id = '2498543') = 24, 'Andy could not change Justin''s prediction');

-- Scoring matches the app's rules (Sharks won 26-24 away at Pumas in R1, captain)
select pg_temp.check((select total_pts from public.pool_pick_scores where team_id = '142073') = (10 + 5 - 2) * 2,
  'captain Sharks score (10 win + 5 attack - 2 defence) x2 = 26');
select pg_temp.check((select total_pts from public.prediction_scores where match_id = '2498543') = (6 + 5 + 2 + 2 + 5) * 2,
  'exact prediction on the Banker scores 20 x2 = 40');
select pg_temp.check((select total_pts from public.prediction_scores where match_id = '2498544') = 6,
  'right result only scores 6');
select pg_temp.check((select total_points from public.pool_leaderboard where team_name = 'Daines XV') = 46,
  'leaderboard totals predictions only');
select pg_temp.check((select (res_pts, mar_pts, cls_pts, exa_pts, banker_pts) = (12::bigint, 5::bigint, 4::bigint, 5::bigint, 20::bigint)
  from public.pool_leaderboard where team_name = 'Daines XV'), 'leaderboard breakdown adds up: 12 + 5 + 4 + 5 + 20 Banker = 46');

-- The ingest transform: a TheSportsDB round payload lands in core, idempotently
insert into raw.feed_payloads (source, endpoint, params, payload) values ('thesportsdb', 'eventsround.php', '{"r":1}',
  '{"events":[{"idEvent":"2498543","idLeague":"5069","strSeason":"2026","intRound":"1","dateEvent":"2026-07-17","strTime":"14:00:00",
    "idHomeTeam":"142072","idAwayTeam":"142073","intHomeScore":"24","intAwayScore":"27","strVenue":"Mbombela Stadium","strStatus":"FT"}]}');
select pg_temp.check(core_load_events((select max(id) from raw.feed_payloads)) = 1, 'a changed score updates core');
select pg_temp.check(core_load_events((select max(id) from raw.feed_payloads)) = 0, 'rerunning the same payload changes nothing');
select pg_temp.check((select away_score from public.matches where id = '2498543') = 27, 'core carries the new score');

-- Per-match lookups for any tournament: the event names its league and season
insert into raw.feed_payloads (source, endpoint, params, payload) values ('thesportsdb', 'lookupevent.php', '{"id":"2550100"}',
  '{"events":[{"idEvent":"2550100","idLeague":"4446","strSeason":"2026-2027","intRound":"1","strTimestamp":"2026-09-26T16:30:00",
    "idHomeTeam":"135606","strHomeTeam":"Zebre","idAwayTeam":"999001","strAwayTeam":"The Newcomers","strAwayTeamBadge":"https://example.com/b.png",
    "intHomeScore":null,"intAwayScore":null,"strStatus":"NS"},
   {"idEvent":"1","idLeague":"4328","strSeason":"2026-2027","intRound":"1","strTimestamp":"2026-09-26T14:00:00",
    "idHomeTeam":"133604","strHomeTeam":"Arsenal","idAwayTeam":"133602","strAwayTeam":"Chelsea","strStatus":"NS"}]}');
select pg_temp.check(core_load_events((select max(id) from raw.feed_payloads)) = 1, 'a URC match loads; a league we don''t run is skipped');
select pg_temp.check((select season from public.matches where id = '2550100') = 'urc-2026-27', 'the match lands in URC 2026-27');
select pg_temp.check((select badge_url from public.teams where id = '999001') = 'https://example.com/b.png', 'a team the feed introduces is added, with its badge');
select pg_temp.check(not exists (select 1 from public.teams where id = '133604'), 'no teams from other leagues');

-- Supabase's invite inserts the user, then stamps invited_at in an update
reset role;
insert into auth.users (id, email, invited_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000c', 'christo@example.com', null, '{}');
update auth.users set invited_at = now() where id = '00000000-0000-0000-0000-00000000000c';
select pg_temp.check(exists (select 1 from public.members where user_id = '00000000-0000-0000-0000-00000000000c'),
  'an invite stamped after the insert still makes a member');

-- Chat: pool mates talk, tags are read out, nobody posts as someone else
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.chat_messages (pool_id, body) values (:poolid,
  '<@00000000-0000-0000-0000-00000000000b> looks like you''re taking this round. <@00000000-0000-0000-0000-00000000000c> <@00000000-0000-0000-0000-0000000000ff>?');
select pg_temp.check((select count(*) from public.chat_mentions) = 1, 'a tag counts only for someone in the pool');
select pg_temp.check((select user_id::text from public.chat_mentions) = '00000000-0000-0000-0000-00000000000b', 'the tag points at Andy');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.chat_messages) = 1, 'Andy reads the chat');
do $$ begin
  insert into public.chat_messages (pool_id, author_id, body)
  select id, '00000000-0000-0000-0000-00000000000a', 'I am Justin' from public.pools;
  raise exception 'FAILED: posted as someone else';
exception when insufficient_privilege then raise notice 'ok: nobody posts as someone else';
end $$;
delete from public.chat_messages;
do $$ begin
  update public.chat_messages set body = 'edited';
  raise exception 'FAILED: edited a message';
exception when insufficient_privilege then raise notice 'ok: messages cannot be edited';
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.chat_messages) = 0, 'a member outside the pool reads none of its chat');
select pg_temp.check((select unread from public.chat_unread) is null, 'and gets no unread count for it');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ff');
select pg_temp.check((select count(*) from public.chat_messages) = 0, 'a stranger reads no chat');
do $$ begin
  insert into public.chat_messages (pool_id, body) values (1, 'let me in');
  raise exception 'FAILED: stranger posted';
exception when insufficient_privilege then raise notice 'ok: a stranger cannot post';
end $$;
reset role;
select pg_temp.check((select count(*) from public.chat_messages) = 1, 'Andy could not delete Justin''s message');

-- Reactions: pool mates react, one of each emoji, only as themselves
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into public.chat_reactions (message_id, emoji) select id, '👍' from public.chat_messages;
insert into public.chat_reactions (message_id, emoji) select id, '🔥' from public.chat_messages;
select pg_temp.check((select count(*) from public.chat_reactions where user_id = auth.uid()) = 2, 'a pool mate reacts');
do $$ begin
  insert into public.chat_reactions (message_id, emoji) select id, '👍' from public.chat_messages;
  raise exception 'FAILED: same emoji twice';
exception when unique_violation then raise notice 'ok: one of each emoji per person';
end $$;
do $$ begin
  insert into public.chat_reactions (message_id, emoji) select id, 'x' from public.chat_messages;
  raise exception 'FAILED: odd emoji accepted';
exception when check_violation then raise notice 'ok: only the fixed emoji set';
end $$;
do $$ begin
  insert into public.chat_reactions (message_id, user_id, emoji) select id, '00000000-0000-0000-0000-00000000000a', '😂' from public.chat_messages;
  raise exception 'FAILED: reacted as someone else';
exception when insufficient_privilege then raise notice 'ok: nobody reacts as someone else';
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.chat_reactions) = 0, 'reactions stay inside the pool');
reset role;
do $$ declare mid bigint := (select id from public.chat_messages limit 1); begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
  insert into public.chat_reactions (message_id, emoji) values (mid, '😂');
  raise exception 'FAILED: reacted outside own pool';
exception when insufficient_privilege then raise notice 'ok: nobody reacts in a pool they''re not in';
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
delete from public.chat_reactions;
select pg_temp.check((select count(*) from public.chat_reactions) = 2, 'nobody removes another member''s reaction');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
delete from public.chat_reactions where emoji = '🔥';
select pg_temp.check((select count(*) from public.chat_reactions) = 1, 'a reaction can be taken back');
reset role;

-- Kickoff reminders, on a live season: one match started, one in 30 minutes
insert into public.seasons (id, name, is_replay, competition_id, feed_season) values ('2027', 'Currie Cup 2027', false, '5069', '2027');
insert into public.pools (season, name, created_by) values ('2027', 'Live pool', '00000000-0000-0000-0000-00000000000a');
insert into public.pool_members (pool_id, user_id)
select id, u from public.pools, unnest(array['00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c']::uuid[]) u
where name = 'Live pool';
insert into public.matches (id, season, round, kickoff_at, home_team_id, away_team_id, status, source) values
  ('t-started', '2027', 1, now() - interval '1 minute', '142072', '142073', 'SCHEDULED', 'test'),
  ('t-soon',    '2027', 1, now() + interval '30 minutes', '142075', '142070', 'SCHEDULED', 'test'),
  ('t-later',   '2027', 1, now() + interval '3 hours', '142067', '142068', 'SCHEDULED', 'test');
select pg_temp.check((select count(*) from notify.due_reminders()) = 3, 'three members have no score for the match in 30 minutes');
select pg_temp.check((select bool_and(match_ids = array['t-soon']) from notify.due_reminders()), 'only the match inside the hour is in the reminder');
insert into public.entries (user_id, season, team_name) values ('00000000-0000-0000-0000-00000000000a', '2027', 'Daines XV');
insert into public.predictions (entry_id, match_id, home_score, away_score)
select id, 't-soon', 20, 18 from public.entries where season = '2027';
do $$ begin
  insert into public.predictions (entry_id, match_id, home_score, away_score)
  select id, 't-started', 20, 18 from public.entries where season = '2027';
  raise exception 'FAILED: called a match after kickoff';
exception when raise_exception then raise notice 'ok: a live match locks at its own kickoff';
end $$;
select pg_temp.check((select count(*) from notify.due_reminders()) = 2, 'a called score means no reminder');
update public.members set email_reminders = false where user_id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select count(*) from notify.due_reminders()) = 1, 'reminders can be turned off');
insert into notify.reminders_sent (user_id, match_id) values ('00000000-0000-0000-0000-00000000000c', 't-soon');
select pg_temp.check((select count(*) from notify.due_reminders()) = 0, 'nobody is reminded twice');

-- Seeing calls: hidden before kickoff, shown to pool mates after it
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.predictions where match_id = 't-soon') = 0, 'a pool mate''s call is hidden before kickoff');
reset role;
update public.matches set kickoff_at = now() - interval '1 minute' where id = 't-soon';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.predictions where match_id = 't-soon') = 1, 'a pool mate''s call shows after kickoff');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.predictions where match_id = '2498543') = 0, 'calls stay hidden from members outside the pool');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.predictions) = 3, 'you always see your own calls');
reset role;

-- Early locks: see a mate's call before kickoff only once you've both locked
reset role;
update public.matches set kickoff_at = now() + interval '2 hours' where id = 't-later';
insert into public.entries (user_id, season, team_name) values ('00000000-0000-0000-0000-00000000000b', '2027', 'Reeves XV');
insert into public.predictions (entry_id, match_id, home_score, away_score)
select id, 't-later', 30, 10 from public.entries where season = '2027';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.match_locks (entry_id, match_id) select id, 't-later' from public.entries where season = '2027' and user_id = auth.uid();
do $$ begin
  update public.predictions set home_score = 1 where match_id = 't-later' and entry_id in (select id from public.entries where user_id = auth.uid());
  raise exception 'FAILED: changed a locked call';
exception when raise_exception then raise notice 'ok: a locked call cannot change';
end $$;
select pg_temp.check((select count(*) from public.predictions where match_id = 't-later') = 1, 'locking alone shows nobody else''s call');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.predictions where match_id = 't-later') = 1, 'an unlocked mate cannot see a locked call');
insert into public.match_locks (entry_id, match_id) select id, 't-later' from public.entries where season = '2027' and user_id = auth.uid();
select pg_temp.check((select count(*) from public.predictions where match_id = 't-later') = 2, 'both locked: both calls show');
do $$ begin
  delete from public.match_locks;
  raise exception 'FAILED: undid a lock';
exception when insufficient_privilege then raise notice 'ok: a match lock cannot be undone';
end $$;
reset role;

-- Loopholes closed in the 2026-09-23 security review
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  update public.predictions set match_id = 't-future'
  where match_id = 't-later' and entry_id in (select id from public.entries where user_id = auth.uid());
  raise exception 'FAILED: moved a locked call to an open match';
exception when raise_exception then raise notice 'ok: a locked call cannot be moved to another match';
end $$;
do $$ begin
  insert into public.chat_messages (pool_id, body, created_at)
  select pool_id, 'from the future', now() + interval '1 year' from public.pool_members where user_id = auth.uid() limit 1;
  raise exception 'FAILED: posted a chat message with its own date';
exception when insufficient_privilege then raise notice 'ok: chat times come from the database';
end $$;
do $$ begin
  update public.members set display_name = 'andy' where user_id = auth.uid();
  raise exception 'FAILED: took a mate''s display name';
exception when unique_violation then raise notice 'ok: display names are unique, ignoring case';
end $$;
do $$ begin
  update public.members set display_name = repeat('x', 25) where user_id = auth.uid();
  raise exception 'FAILED: a 25-character display name was accepted';
exception when check_violation then raise notice 'ok: display names stay short';
end $$;
reset role;

-- Scores a rugby side can't post are refused
insert into public.matches (id, season, round, kickoff_at, home_team_id, away_team_id, status, source)
values ('t-future', '2027', 2, now() + interval '5 days', '142072', '142073', 'SCHEDULED', 'test');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  insert into public.predictions (entry_id, match_id, home_score, away_score)
  select id, 't-future', 4, 10 from public.entries where user_id = auth.uid() and season = '2027';
  raise exception 'FAILED: a score of 4 was accepted';
exception when check_violation then raise notice 'ok: 1, 2 and 4 are not rugby scores';
end $$;
insert into public.predictions (entry_id, match_id, home_score, away_score)
select id, 't-future', 3, 0 from public.entries where user_id = auth.uid() and season = '2027';
reset role;

-- Bonus points from Wikipedia's log: our losing bonus, their try bonus
insert into public.matches (id, season, round, kickoff_at, home_team_id, away_team_id, home_score, away_score, status, source)
values ('t-played', '2027', 1, now() - interval '3 hours', '142072', '142073', 31, 24, 'FT', 'test');
insert into raw.feed_payloads (source, endpoint, params, payload)
select 'wikipedia', 'wikipedia:parse', '{"season": "2027"}', jsonb_build_object('parse', jsonb_build_object('wikitext',
  E'Intro\n{{#invoke:sports table|main|style=Rugby\n|section=URC league standings\n' ||
  E'| team1  = AAA | name_AAA = {{flagdeco|RSA}} [[2027 ' || h.display_name || ' season|' || h.display_name || E' Rugby]]\n' ||
  E'| team2  = BBB | name_BBB = {{flagdeco|RSA}} [[' || a.display_name || E']]\n' ||
  E'| win_AAA = 1 | draw_AAA = 0 | loss_AAA = 0 | tb_AAA = 1 | lb_AAA = 0\n' ||
  E'| win_BBB = 0 | draw_BBB = 0 | loss_BBB = 1 | tb_BBB = 1 | lb_BBB = 1\n}}\n{{#invoke:sports table|main|section=other\n| win_AAA = 9\n}}'))
from public.teams h, public.teams a where h.id = '142072' and a.id = '142073';
select pg_temp.check(public.core_load_wiki_log((select max(id) from raw.feed_payloads)) = 2, 'Wikipedia''s log lands for both teams');
select pg_temp.check((select log_points from public.standings where season = '2027' and team_id = '142072') = 5, 'win with a try bonus = 5');
select pg_temp.check((select log_points from public.standings where season = '2027' and team_id = '142073') = 2, 'loss by 7 with a try bonus = 2');
select pg_temp.check((select bool_and(points_exact) from public.standings where season = '2027' and team_id in ('142072', '142073')), 'exact once Wikipedia has caught up');
select pg_temp.check((select count(*) from public.standings where season = '2027') = 6, 'every team in the fixtures is on the log');

-- The crowd: totals across every player, only once your own call is locked
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select calls from public.match_crowd('2027') where match_id = 't-soon') = 1, 'crowd shows a kicked-off match to any member');
select pg_temp.check((select home_wins from public.match_crowd('2027') where match_id = 't-soon') is null, 'crowd hides the split below 3 calls');
select pg_temp.check(not exists (select 1 from public.match_crowd('2027') where match_id = 't-later'), 'crowd is hidden before kickoff until you lock');
insert into public.entries (season, team_name) values ('2027', 'Christo XV');
insert into public.predictions (entry_id, match_id, home_score, away_score)
select id, 't-later', 12, 15 from public.entries where user_id = auth.uid() and season = '2027';
insert into public.match_locks (entry_id, match_id) select id, 't-later' from public.entries where season = '2027' and user_id = auth.uid();
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select (calls, home_wins, draws, away_wins, top_home, top_away, top_calls) = (3, 2, 0, 1, 30, 10, 2)
                      from public.match_crowd('2027') where match_id = 't-later'), 'crowd splits and finds the most common call');
insert into public.predictions (entry_id, match_id, home_score, away_score)
select id, 't-future', 10, 3 from public.entries where user_id = auth.uid() and season = '2027';
insert into public.match_locks (entry_id, match_id) select id, 't-future' from public.entries where season = '2027' and user_id = auth.uid();
select pg_temp.check((select calls from public.match_crowd('2027') where match_id = 't-future') = 1, 'crowd never counts an open call');
select pg_temp.as_user(null);
do $$ begin
  perform public.match_crowd('2027');
  raise exception 'FAILED: anon read the crowd';
exception when insufficient_privilege then raise notice 'ok: anon cannot read the crowd';
end $$;
-- Profile pictures: your own folder only, and only members see them
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-00000000000a/me.jpg');
update public.members set avatar_path = '00000000-0000-0000-0000-00000000000a/me.jpg' where user_id = auth.uid();
select pg_temp.check((select avatar_path from public.members where user_id = auth.uid()) is not null, 'a member sets their own picture');
do $$ begin
  insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-00000000000c/fake.jpg');
  raise exception 'FAILED: uploaded into someone else''s folder';
exception when insufficient_privilege then raise notice 'ok: nobody uploads into another member''s folder';
end $$;
do $$ begin
  update public.members set avatar_path = '00000000-0000-0000-0000-00000000000c/x.jpg' where user_id = auth.uid();
  raise exception 'FAILED: pointed a picture at another member''s folder';
exception when check_violation then raise notice 'ok: a picture can only point at your own folder';
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from storage.objects where bucket_id = 'avatars') = 1, 'members see each other''s pictures');
delete from storage.objects where bucket_id = 'avatars';
select pg_temp.check((select count(*) from storage.objects where bucket_id = 'avatars') = 1, 'nobody deletes another member''s picture');
select pg_temp.as_user(null);
select pg_temp.check((select count(*) from storage.objects) = 0, 'signed-out visitors see no pictures');
reset role;

-- Schools: one primary and one high school each, visible to the league, fixed after 14 days
insert into public.schools (emis, name, town, province, no_fee, offers_primary, offers_matric, source) values
  ('200100120', 'Clarendon Park Primary School', 'Gqeberha', 'EC', false, true, false, 'test'),
  ('200100823', 'Victoria Park High School', 'Gqeberha', 'EC', false, false, true, 'test');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  insert into public.member_schools (user_id, stage, emis) values (auth.uid(), 'primary', '200100823');
  raise exception 'FAILED: a high school was saved as a primary school';
exception when check_violation then raise notice 'ok: a primary school must teach primary grades';
end $$;
insert into public.member_schools (user_id, stage, emis, last_year) values
  (auth.uid(), 'primary', '200100120', 1990), (auth.uid(), 'high', '200100823', 1997);
do $$ begin
  insert into public.member_schools (user_id, stage, emis) values ('00000000-0000-0000-0000-00000000000b', 'high', '200100823');
  raise exception 'FAILED: set a school for someone else';
exception when insufficient_privilege then raise notice 'ok: nobody sets another member''s school';
end $$;
update public.member_schools set last_year = 1998 where user_id = auth.uid() and stage = 'high';
select pg_temp.check((select last_year from public.member_schools where user_id = auth.uid() and stage = 'high') = 1998, 'a new choice can be corrected');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.member_schools) = 2, 'members see each other''s schools');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ff');
select pg_temp.check((select count(*) from public.schools) + (select count(*) from public.member_schools) = 0, 'uninvited users see no schools');
select pg_temp.as_user(null);
reset role;  -- an admin fix, with no signed-in user
update public.member_schools set first_saved_at = now() - interval '15 days';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  update public.member_schools set emis = '200100823', last_year = 1997 where user_id = auth.uid() and stage = 'high';
  raise exception 'FAILED: changed a fixed school';
exception when insufficient_privilege then raise notice 'ok: a school is fixed after 14 days';
end $$;
delete from public.member_schools where user_id = auth.uid();
select pg_temp.check((select count(*) from public.member_schools where user_id = auth.uid()) = 2, 'a fixed school can''t be removed and re-added');
reset role;

-- Vouching: two schoolmates confirm you; a vouch lapses if either moves school
insert into public.schools (emis, name, town, province, no_fee, offers_primary, offers_matric, source) values
  ('200100999', 'Other High School', 'Gqeberha', 'EC', true, false, true, 'test');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into public.member_schools (user_id, stage, emis, last_year) values (auth.uid(), 'high', '200100823', 1997);
insert into public.school_vouches (voucher_id, member_id, stage, emis) values (auth.uid(), '00000000-0000-0000-0000-00000000000a', 'high', '200100823');
do $$ begin
  insert into public.school_vouches (voucher_id, member_id, stage, emis) values (auth.uid(), '00000000-0000-0000-0000-00000000000a', 'primary', '200100120');
  raise exception 'FAILED: vouched for a school the voucher never went to';
exception when insufficient_privilege then raise notice 'ok: only schoolmates can vouch';
end $$;
do $$ begin
  insert into public.school_vouches (voucher_id, member_id, stage, emis) values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a', 'high', '200100823');
  raise exception 'FAILED: vouched in someone else''s name';
exception when insufficient_privilege then raise notice 'ok: nobody vouches in another member''s name';
end $$;
do $$ begin
  insert into public.school_vouches (voucher_id, member_id, stage, emis) values (auth.uid(), auth.uid(), 'high', '200100823');
  raise exception 'FAILED: vouched for themselves';
exception when insufficient_privilege or check_violation then raise notice 'ok: nobody vouches for themselves';
end $$;
select pg_temp.check((select (vouches, verified) = (1, false) from public.school_members
                      where user_id = '00000000-0000-0000-0000-00000000000a' and stage = 'high'), 'one vouch is not enough');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
insert into public.member_schools (user_id, stage, emis, last_year) values (auth.uid(), 'high', '200100823', 2001);
insert into public.school_vouches (voucher_id, member_id, stage, emis) values (auth.uid(), '00000000-0000-0000-0000-00000000000a', 'high', '200100823');
select pg_temp.check((select verified from public.school_members
                      where user_id = '00000000-0000-0000-0000-00000000000a' and stage = 'high'), 'two schoolmates verify you');
update public.member_schools set emis = '200100999' where user_id = auth.uid() and stage = 'high';
select pg_temp.check((select (vouches, verified) = (1, false) from public.school_members
                      where user_id = '00000000-0000-0000-0000-00000000000a' and stage = 'high'), 'a vouch lapses when the voucher moves school');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
delete from public.school_vouches where voucher_id = '00000000-0000-0000-0000-00000000000c';
select pg_temp.check((select count(*) from public.school_vouches where voucher_id = '00000000-0000-0000-0000-00000000000c') = 1, 'nobody takes back another member''s vouch');
delete from public.school_vouches where voucher_id = auth.uid();
select pg_temp.check((select vouches from public.school_members
                      where user_id = '00000000-0000-0000-0000-00000000000a' and stage = 'high') = 0, 'a vouch can be taken back');
select pg_temp.as_user(null);
do $$ begin
  perform 1 from public.school_members;
  raise exception 'FAILED: anon read schools';
exception when insufficient_privilege then raise notice 'ok: signed-out visitors see no schools or vouches';
end $$;
reset role;

-- School pools: saving a school puts you in its pool, for every tournament
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.pools where school_emis = '200100823' and school_stage = 'high' and school_year is null)
                     = (select count(*) from public.seasons), 'a school pool per tournament');
select pg_temp.check((select name from public.pools where school_emis = '200100823' and school_year is null limit 1) = 'Victoria Park High School', 'named after the school');
select pg_temp.check((select count(distinct pm.user_id) from public.pool_members pm join public.pools p on p.id = pm.pool_id
                      where p.school_emis = '200100823') = 2, 'schoolmates share the pool');
-- Class pools: a pool per final year, and chat only there
select pg_temp.check((select name from public.pools where school_emis = '200100823' and school_year = 1998 limit 1)
                     = 'Victoria Park High School Class of 1998', 'a class pool is named after the school and year');
select pg_temp.check((select count(*) from public.pool_members pm join public.pools p on p.id = pm.pool_id
                      where p.school_emis = '200100823' and p.school_year = 1998 and pm.user_id = auth.uid())
                     = (select count(*) from public.seasons), 'you are in your class pool for every tournament');
select pg_temp.check((select count(*) from public.pools where school_emis = '200100823' and school_year = 1997) = 0,
                     'another class''s pool stays out of sight');
select pg_temp.check(public.class_pool_name('Hoërskool Jan van Riebeeck Pretoria', 2017::smallint) = 'Hoërskool Jan van Riebeec… Class of 2017',
                     'long school names are shortened to fit');
do $$ begin
  insert into public.chat_messages (pool_id, author_id, body)
  select id, auth.uid(), 'Hello everyone' from public.pools where school_emis = '200100823' and school_year is null limit 1;
  raise exception 'FAILED: chatted in a whole-school pool';
exception when insufficient_privilege then raise notice 'ok: whole-school pools have no chat';
end $$;
insert into public.chat_messages (pool_id, author_id, body)
select id, auth.uid(), 'Class of 98!' from public.pools where school_emis = '200100823' and school_year = 1998 limit 1;
select pg_temp.check((select count(*) from public.chat_messages where body = 'Class of 98!') = 1, 'class pools have chat');
select pg_temp.check((select count(*) from public.school_classes((select id from public.pools where school_emis = '200100823' and school_year is null limit 1))) = 2,
                     'the school pool lists its class years');
select pg_temp.check((select count(*) from public.school_classes((select id from public.pools where school_emis = '200100120' and school_year is null limit 1))) = 1,
                     'primary schools have class years too');
delete from public.pool_members where pool_id in (select id from public.pools where school_emis is not null);
select pg_temp.check((select count(*) from public.pool_members pm join public.pools p on p.id = pm.pool_id
                      where p.school_emis is not null and pm.user_id = auth.uid()) > 0, 'nobody leaves a school pool by hand');
do $$ begin
  insert into public.pools (season, name, school_emis, school_stage) values ('2026', 'Fake', '200100120', 'primary');
  raise exception 'FAILED: made a school pool by hand';
exception when insufficient_privilege then raise notice 'ok: only the app makes school pools';
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.pools where school_emis = '200100823') = 0, 'other schools can''t see the pool');
select pg_temp.check((select count(*) from public.school_classes((select id from public.pools where school_emis = '200100823' and school_year is null limit 1))) = 0,
                     'outsiders get no class table');
do $$ declare c text; begin
  reset role; select join_code into c from public.pools where school_emis = '200100823' limit 1;
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
  perform public.join_pool(c);
  raise exception 'FAILED: joined a school pool by code';
exception when raise_exception then raise notice 'ok: no joining a school pool by code';
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
delete from public.member_schools where user_id = auth.uid() and stage = 'high';
select pg_temp.check((select count(*) from public.pool_members pm join public.pools p on p.id = pm.pool_id
                      where p.school_emis = '200100823' and pm.user_id = auth.uid()) = 0, 'removing your school takes you out of its pool');
reset role;

-- Chat history: a newcomer sees the pool's chat from when they joined
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.pools (season, name, created_by) values ('2026', 'History', auth.uid());
insert into public.chat_messages (pool_id, body) select id, 'before you got here' from public.pools where name = 'History';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ declare c text; begin
  reset role; select join_code into c from public.pools where name = 'History';
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
  perform public.join_pool(c);
end $$;
select pg_temp.check((select count(*) from public.chat_messages c join public.pools p on p.id = c.pool_id where p.name = 'History') = 0,
  'a newcomer doesn''t see chat from before they joined');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.chat_messages (pool_id, body) select id, 'welcome' from public.pools where name = 'History';
select pg_temp.check((select count(*) from public.chat_messages c join public.pools p on p.id = c.pool_id where p.name = 'History') = 2,
  'the pool''s starter still sees everything');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.chat_messages c join public.pools p on p.id = c.pool_id where p.name = 'History') = 1,
  'a newcomer sees what''s said after they join');
reset role;

-- School table: average points of confirmed players, ranked once a school has 3
reset role;
insert into public.schools (emis, name, town, province, no_fee, offers_primary, offers_matric, source, learners) values
  ('200100777', 'Table High School', 'Gqeberha', 'EC', false, false, true, 'test', 250);
delete from public.school_vouches where stage = 'high';
delete from public.member_schools where stage = 'high';
insert into public.member_schools (user_id, stage, emis, last_year) values
  ('00000000-0000-0000-0000-00000000000a', 'high', '200100777', 1997),
  ('00000000-0000-0000-0000-00000000000b', 'high', '200100777', 1997),
  ('00000000-0000-0000-0000-00000000000c', 'high', '200100777', 1997);
insert into public.entries (user_id, season, team_name)
  select u, '2026', 'Team' from unnest(array['00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b',
                                             '00000000-0000-0000-0000-00000000000c']::uuid[]) u
  on conflict do nothing;
insert into public.school_vouches (voucher_id, member_id, stage, emis)
  select v, m, 'high', '200100777'
  from unnest(array['00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b']::uuid[]) v,
       unnest(array['00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b']::uuid[]) m
  where v <> m;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select members = 3 and confirmed = 0 and average is null from public.school_table('2026', 'high')
                      where emis = '200100777'), 'one vouch each confirms nobody, so the school is unranked');
reset role;
insert into public.school_vouches (voucher_id, member_id, stage, emis)
  select '00000000-0000-0000-0000-00000000000c', m, 'high', '200100777'
  from unnest(array['00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b']::uuid[]) m;
insert into public.school_vouches (voucher_id, member_id, stage, emis) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000c', 'high', '200100777');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select confirmed = 2 and average is null and points is null from public.school_table('2026', 'high')
                      where emis = '200100777'), 'two confirmed players: points withheld');
reset role;
insert into public.school_vouches (voucher_id, member_id, stage, emis) values
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c', 'high', '200100777');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select confirmed = 3 and mine and average = round(points::numeric / 3, 1)
                      from public.school_table('2026', 'high') where emis = '200100777'), 'three confirmed players: ranked on their average');
select pg_temp.check((select points from public.school_table('2026', 'high') where emis = '200100777')
                     = (select coalesce(sum(s.total_pts), 0) from public.prediction_scores s join public.entries e on e.id = s.entry_id
                        where e.season = '2026' and e.user_id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b',
                                                                   '00000000-0000-0000-0000-00000000000c')),
                     'school points are its confirmed players'' points');
select pg_temp.check((select count(*) from public.school_table('2026', 'primary') where emis = '200100777') = 0, 'a high school isn''t in the primary table');
select pg_temp.check((select seats = 3 from public.school_table('2026', 'high') where emis = '200100777'), 'a 250-learner school fields 3');
reset role;
select pg_temp.check(public.school_seats(null) = 5 and public.school_seats(80) = 3 and public.school_seats(546) = 6
                     and public.school_seats(1000) = 10 and public.school_seats(2400) = 15, 'team size: 1 per 100 learners, 3 to 15, 5 if unknown');
update public.schools set learners = 1500 where emis = '200100777';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select seats = 15 and average = round(points::numeric / 15, 1) from public.school_table('2026', 'high')
                      where emis = '200100777'), 'a big school with 3 players leaves 12 empty seats on 0');
reset role;
update public.schools set learners = 250 where emis = '200100777';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
reset role;
set role anon;
do $$ begin
  perform 1 from public.school_table('2026', 'high');
  raise exception 'FAILED: anon read the school table';
exception when insufficient_privilege then raise notice 'ok: signed-out visitors can''t read the school table';
end $$;
reset role;

-- Chat photos: only in your pools, only from your own folder, only pool members see them
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ declare pid bigint; begin
  select id into pid from public.pools where name = 'History';
  insert into storage.objects (bucket_id, name) values ('chat-photos', pid || '/' || auth.uid() || '/pic1.jpg');
  insert into public.chat_messages (pool_id, body, image_path) values (pid, '', pid || '/' || auth.uid() || '/pic1.jpg');
  raise notice 'ok: a photo can be posted without words';
  begin
    insert into public.chat_messages (pool_id, body) values (pid, '   ');
    raise exception 'FAILED: posted an empty message';
  exception when check_violation then raise notice 'ok: a message needs words or a photo';
  end;
  begin
    insert into public.chat_messages (pool_id, body, image_path) values (pid, 'x', pid || '/00000000-0000-0000-0000-00000000000b/pic.jpg');
    raise exception 'FAILED: pointed at someone else''s photo';
  exception when check_violation then raise notice 'ok: a message only shows its author''s photos';
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('chat-photos', pid || '/00000000-0000-0000-0000-00000000000b/pic.jpg');
    raise exception 'FAILED: uploaded into someone else''s folder';
  exception when insufficient_privilege then raise notice 'ok: photos go only in your own folder';
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('chat-photos', '999999/' || auth.uid() || '/pic.jpg');
    raise exception 'FAILED: uploaded into a pool you''re not in';
  exception when insufficient_privilege then raise notice 'ok: photos go only in your pools';
  end;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from storage.objects where bucket_id = 'chat-photos') = 1, 'pool mates see the photo');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from storage.objects where bucket_id = 'chat-photos') = 0, 'others don''t see the photo');
reset role;

-- School search: nicknames, no accents, the list's short forms, primary vs high
reset role;
insert into public.schools (emis, name, town, province, no_fee, offers_primary, offers_matric, source, aka) values
  ('108310249', 'Hoër Jongenskool Paarl', 'Paarl', 'WC', false, false, true, 'test', array['Paarl Boys'' High', 'Boishaai']),
  ('440304211', 'Grey-Kollege S/S', 'Bloemfontein', 'FS', false, false, true, 'test', '{}'),
  ('440304230', 'Grey-Kollege P/S', 'Bloemfontein', 'FS', false, true, false, 'test', '{}');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select emis from public.search_schools('paarl boys', 'high')) = '108310249', 'a nickname finds the school');
select pg_temp.check((select emis from public.search_schools('BOISHAAI', 'high')) = '108310249', 'search ignores case');
select pg_temp.check((select emis from public.search_schools('hoer jongens', 'high')) = '108310249', 'search ignores accents');
select pg_temp.check((select emis from public.search_schools('grey kollege secondary', 'high')) = '440304211', 'S/S reads as secondary');
select pg_temp.check((select array_agg(emis) from public.search_schools('grey kollege', 'primary')) = array['440304230'], 'primary search only lists primary schools');
select pg_temp.check((select count(*) from public.search_schools('gr', 'high')) = 0, 'too short to search');
reset role;
set role anon;
do $$ begin
  perform 1 from public.search_schools('paarl', 'high');
  raise exception 'FAILED: anon searched schools';
exception when insufficient_privilege then raise notice 'ok: signed-out visitors can''t search schools';
end $$;
reset role;

-- Stored scores: always the same as scoring every call from scratch
reset role;
create temp view stored_ok as
  select not exists (select * from public.prediction_points except select * from public.compute_points())
     and not exists (select * from public.compute_points() except select * from public.prediction_points)
     and not exists (
       select 1 from public.entry_round_totals t
       full join (select entry_id, round, sum(total_pts) tp, sum(result_pts) rp, sum(margin_pts) mp, sum(near_pts) np,
                         sum(exact_pts) ep, count(*) filter (where right_result) rr, count(*) filter (where exact_pts > 0) es, count(*) n
                  from public.prediction_points group by 1, 2) a using (entry_id, round)
       where (t.total_pts, t.result_pts, t.margin_pts, t.near_pts, t.exact_pts, t.right_results, t.exact_scores, t.matches)
             is distinct from (a.tp::int, a.rp::int, a.mp::int, a.np::int, a.ep::int, a.rr::int, a.es::int, a.n::int)) as ok;
select pg_temp.check((select count(*) from public.prediction_points) > 0, 'the tests scored some calls');
select pg_temp.check((select ok from stored_ok), 'after all the tests, stored points and round totals match a fresh scoring');
create temp table fixed as select match_id, max(real_home) h from public.prediction_points group by match_id limit 1;
update public.matches m set home_score = f.h + 7 from fixed f where m.id = f.match_id;
select pg_temp.check((select ok from stored_ok) and exists (select 1 from public.prediction_points p join fixed f using (match_id) where p.real_home = f.h + 7),
                     'a corrected result is re-scored straight away');
update public.matches m set status = 'SCHEDULED', home_score = null, away_score = null from fixed f where m.id = f.match_id;
select pg_temp.check((select ok from stored_ok) and not exists (select 1 from public.prediction_points p join fixed f using (match_id)),
                     'a result taken back removes its points');
update public.matches m set status = 'FT', home_score = f.h, away_score = 20 from fixed f where m.id = f.match_id;
select pg_temp.check((select ok from stored_ok), 'the result coming back scores it again');
select public.rescore_all();
select pg_temp.check((select ok from stored_ok), 'a full rebuild gives the same numbers');
set role anon;
do $$ begin
  perform 1 from public.prediction_points;
  raise exception 'FAILED: anon read stored points';
exception when insufficient_privilege then raise notice 'ok: signed-out visitors can''t read stored points';
end $$;
reset role;
set role authenticated;
do $$ begin
  delete from public.entry_round_totals;
  raise exception 'FAILED: a player changed stored totals';
exception when insufficient_privilege then raise notice 'ok: players can''t change stored totals';
end $$;
reset role;

-- Round prizes: the pool creator's public promise
reset role;
insert into public.seasons (id, name, is_replay, competition_id, feed_season) values ('prize', 'Prize test', false, '5069', 'prize');
insert into public.pools (season, name, created_by) values ('prize', 'Prize pool', '00000000-0000-0000-0000-00000000000a');
insert into public.pool_members (pool_id, user_id, joined_at)
select id, u, now() - interval '30 days' from public.pools,
       unnest(array['00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c']::uuid[]) u
where name = 'Prize pool'
on conflict (pool_id, user_id) do update set joined_at = excluded.joined_at;
update public.pool_members set joined_at = now() - interval '30 days' where pool_id = (select id from public.pools where name = 'Prize pool');
insert into public.matches (id, season, round, kickoff_at, home_team_id, away_team_id, status, source) values
  ('p1a', 'prize', 1, now() + interval '1 day', '142072', '142073', 'SCHEDULED', 'test'),
  ('p1b', 'prize', 1, now() + interval '1 day 2 hours', '142075', '142070', 'SCHEDULED', 'test'),
  ('p2a', 'prize', 2, now() + interval '8 days', '142072', '142073', 'SCHEDULED', 'test'),
  ('p3a', 'prize', 3, now() + interval '15 days', '142072', '142073', 'SCHEDULED', 'test');
insert into public.entries (user_id, season, team_name)
select u, 'prize', 'Team' from unnest(array['00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b',
                                             '00000000-0000-0000-0000-00000000000c']::uuid[]) u;
create temp table pp as select id from public.pools where name = 'Prize pool';
grant select on pp to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.round_prizes (pool_id, round, sponsor, prize) select id, 1, 'Joe''s Pub', 'R200 bar tab' from pp;
select pg_temp.check((select offered_by from public.round_prizes where round = 1 and pool_id = (select id from pp)) = '00000000-0000-0000-0000-00000000000a',
                     'the creator puts up a prize, in their own name');
do $$ begin
  update public.round_prizes set prize = 'Nothing' where round = 1;
  raise exception 'FAILED: a prize was edited';
exception when insufficient_privilege then raise notice 'ok: a prize can''t be edited';
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  insert into public.round_prizes (pool_id, round, sponsor, prize) select id, 2, 'Me', 'A beer' from pp;
  raise exception 'FAILED: someone who didn''t start the pool offered a prize';
exception when insufficient_privilege then raise notice 'ok: only the pool''s creator offers prizes';
end $$;
select pg_temp.check((select status from public.pool_prizes((select id from pp)) where round = 1) = 'upcoming', 'before kickoff the prize is upcoming');
-- Round 1 kicks off; c only joins after kickoff
reset role;
insert into public.predictions (entry_id, match_id, home_score, away_score)
select e.id, m.id, case e.user_id when '00000000-0000-0000-0000-00000000000b' then 20
                               when '00000000-0000-0000-0000-00000000000c' then 24 else 10 end, 17
from public.entries e cross join (values ('p1a'), ('p1b')) m(id) where e.season = 'prize';
update public.matches set kickoff_at = now() - interval '3 hours' where id in ('p1a', 'p1b');
update public.pool_members set joined_at = now() - interval '1 hour'
where pool_id = (select id from pp) and user_id = '00000000-0000-0000-0000-00000000000c';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
delete from public.round_prizes where round = 1;
select pg_temp.check((select count(*) from public.round_prizes where round = 1) = 1, 'after kickoff the prize can''t be taken back');
select pg_temp.check((select status from public.pool_prizes((select id from pp)) where round = 1) = 'in play', 'during the round the prize is in play');
reset role;
update public.matches set status = 'FT', home_score = 24, away_score = 17 where id in ('p1a', 'p1b');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select status = 'awaiting' and winners = array['00000000-0000-0000-0000-00000000000b']::uuid[]
                      from public.pool_prizes((select id from pp)) where round = 1),
                     'the top caller wins; games that started before you joined don''t count');
-- Joining mid-round: only the games still to come count, and they can win on those
reset role;
update public.matches set kickoff_at = now() - interval '1 hour' where id = 'p1b';
update public.pool_members set joined_at = now() - interval '2 hours'
where pool_id = (select id from pp) and user_id = '00000000-0000-0000-0000-00000000000c';
select pg_temp.check((select winners = array['00000000-0000-0000-0000-00000000000c']::uuid[]
                      from public.prize_outcome((select id from pp), 1)),
                     'a late joiner wins on the games after they joined (20 on one exact beats 16)');
update public.matches set kickoff_at = now() - interval '3 hours' where id = 'p1b';
update public.pool_members set joined_at = now() - interval '1 hour'
where pool_id = (select id from pp) and user_id = '00000000-0000-0000-0000-00000000000c';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ begin
  insert into public.prize_receipts (pool_id, round) select id, 1 from pp;
  raise exception 'FAILED: a non-winner marked the prize received';
exception when insufficient_privilege then raise notice 'ok: only a winner can mark a prize received';
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into public.prize_receipts (pool_id, round) select id, 1 from pp;
select pg_temp.check((select status from public.pool_prizes((select id from pp)) where round = 1) = 'delivered', 'the winner marks it received: delivered');
-- A prize nobody confirms goes on the record, and blocks new prizes
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.round_prizes (pool_id, round, sponsor, prize) select id, 2, 'Joe''s Pub', 'R200 bar tab' from pp;
reset role;
insert into public.predictions (entry_id, match_id, home_score, away_score)
select e.id, 'p2a', case when e.user_id = '00000000-0000-0000-0000-00000000000b' then 24 else 10 end, 17 from public.entries e where e.season = 'prize';
update public.matches set kickoff_at = now() - interval '20 days', status = 'FT', home_score = 24, away_score = 17 where id = 'p2a';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select status from public.pool_prizes((select id from pp)) where round = 2) = 'not delivered',
                     'unconfirmed 14 days after the round: not delivered');
select pg_temp.check(not public.can_offer_prize((select id from pp), 3), 'a creator who owes a prize can''t offer another');
do $$ begin
  insert into public.round_prizes (pool_id, round, sponsor, prize) select id, 3, 'Joe''s Pub', 'R200' from pp;
  raise exception 'FAILED: offered a prize while owing one';
exception when insufficient_privilege then raise notice 'ok: owing a prize blocks a new one';
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into public.prize_receipts (pool_id, round) select id, 2 from pp;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check(public.can_offer_prize((select id from pp), 3), 'once it''s received, the creator can offer again');
select pg_temp.check(not public.can_offer_prize((select id from pp), 2), 'no prize for a round that has started');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ff');
select pg_temp.check((select count(*) from public.pool_prizes((select id from pp))) = 0, 'outsiders see no prizes');
reset role;
set role anon;
do $$ begin
  perform 1 from public.round_prizes;
  raise exception 'FAILED: anon read prizes';
exception when insufficient_privilege then raise notice 'ok: signed-out visitors can''t read prizes';
end $$;
reset role;

-- Retention tracking
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.track('open');
select public.track('open');
do $$ begin
  perform public.track('bogus');
  raise exception 'FAILED: logged an unknown activity';
exception when check_violation then raise notice 'ok: only known activities are logged';
end $$;
do $$ begin
  perform 1 from public.activity;
  raise exception 'FAILED: a player read the activity log';
exception when insufficient_privilege then raise notice 'ok: players can''t read the activity log';
end $$;
select pg_temp.check((select count(*) from public.weekly_metrics()) = 0, 'players who aren''t admins see no metrics');
reset role;
select pg_temp.check((select n from public.activity where user_id = '00000000-0000-0000-0000-00000000000b'
                      and kind = 'open' and day = (now() at time zone 'Africa/Johannesburg')::date) = 2, 'app opens are counted per day');
select pg_temp.check(exists (select 1 from public.activity where user_id = '00000000-0000-0000-0000-00000000000b' and kind = 'call'),
                     'making a call is logged by the database');
update public.members set is_admin = true where user_id = '00000000-0000-0000-0000-00000000000a';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select active from public.weekly_metrics(1)) >= 1, 'an admin sees this week''s active players');
select pg_temp.check((select count(*) from public.round_participation('prize')) = 3, 'an admin sees participation per round');
reset role;

-- Personal invite links
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select code as invcode from public.my_invite() \gset
select pg_temp.check((select used = 0 and cap = 20 from public.my_invite()), 'a player gets their own invite link');
select pg_temp.check((select code from public.my_invite()) = :'invcode', 'and keeps the same one');
do $$ begin
  perform 1 from public.invite_codes;
  raise exception 'FAILED: read invite codes directly';
exception when insufficient_privilege then raise notice 'ok: nobody reads other players'' codes';
end $$;
do $$ begin
  perform public.invite_check('x', 'y');
  raise exception 'FAILED: a player called invite_check';
exception when insufficient_privilege then raise notice 'ok: only the join function checks invites';
end $$;
reset role;
select display_name as invname from public.members where user_id = '00000000-0000-0000-0000-00000000000a' \gset
select pg_temp.as_user(null);
select pg_temp.check((select inviter from public.invite_info(:'invcode')) = :'invname',
                     'the join page shows who invited you');
select pg_temp.check((select count(*) from public.invite_info('zzzzzzzzzz')) = 0, 'a made-up code shows nothing');
reset role;
set role service_role;
select pg_temp.check((select inviter::text from public.invite_check(:'invcode', 'newbie@example.com')) = '00000000-0000-0000-0000-00000000000a', 'a good link and a new email may join');
select pg_temp.check((select problem from public.invite_check(:'invcode', 'andy@example.com')) = 'exists', 'someone already in is told to sign in');
select pg_temp.check((select problem from public.invite_check(:'invcode', 'not-an-email')) like '%email%', 'a bad email is refused');
select pg_temp.check((select problem from public.invite_check('zzzzzzzzzz', 'x@example.com')) like '%isn''t valid%', 'a bad link is refused');
reset role;
insert into auth.users (id, email, invited_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000d1', 'newbie@example.com', now(), '{"display_name":"Newbie"}');
set role service_role;
select public.invite_record('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000000a', 'Newbie@Example.com');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select used from public.my_invite()) = 1, 'the invite counts against the link');
select pg_temp.check((select count(*) from public.invites) = 1, 'the inviter sees who they brought in');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.invites) = 0, 'nobody else does');
reset role;
insert into public.member_schools (user_id, stage, emis, last_year) values ('00000000-0000-0000-0000-00000000000a', 'high', '200100823', 2017)
on conflict (user_id, stage) do update set emis = excluded.emis;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
insert into public.member_schools (user_id, stage, emis, last_year) values (auth.uid(), 'high', '200100823', 2017);
reset role;
select pg_temp.check(exists (select 1 from public.school_vouches where voucher_id = '00000000-0000-0000-0000-00000000000a'
                     and member_id = '00000000-0000-0000-0000-0000000000d1' and stage = 'high'),
                     'being invited by a schoolmate counts as their confirmation');
select pg_temp.check(not exists (select 1 from public.school_vouches where member_id = '00000000-0000-0000-0000-0000000000d1' and stage = 'primary'),
                     'but only for the school they share');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.reset_invite_code();
select pg_temp.check((select code from public.my_invite()) <> :'invcode', 'a reset gives a new link');
reset role;
set role service_role;
select pg_temp.check((select problem from public.invite_check(:'invcode', 'another@example.com')) like '%isn''t valid%', 'and the old one stops working');
reset role;

-- Sponsor platform: prices, one sponsor per slot, the split, and results
reset role;
insert into public.seasons (id, name, is_replay, competition_id, feed_season) values ('spon', 'Sponsor test', false, '5069', 'spon');
insert into public.schools (emis, name, town, province, no_fee, offers_primary, offers_matric, source) values
  ('900000001', 'Sponsor High One', 'Stellenbosch', 'WC', false, false, true, 'test'),
  ('900000002', 'Sponsor High Two', 'Stellenbosch', 'WC', false, false, true, 'test'),
  ('900000011', 'No-fee Twin', 'Kayamandi', 'WC', true, false, true, 'test');
insert into public.school_partners (emis, partner_emis) values ('900000001', '900000011');
delete from public.school_vouches where stage = 'high';
delete from public.member_schools where stage = 'high';
insert into public.member_schools (user_id, stage, emis, last_year) values
  ('00000000-0000-0000-0000-00000000000a', 'high', '900000001', 1997),
  ('00000000-0000-0000-0000-00000000000b', 'high', '900000001', 1997),
  ('00000000-0000-0000-0000-00000000000c', 'high', '900000002', 1997);
insert into auth.users (id, email, invited_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000d', 'dee@example.com', now(), '{"display_name":"Dee"}'),
  ('00000000-0000-0000-0000-00000000000e', 'eli@example.com', now(), '{"display_name":"Eli"}')
on conflict do nothing;
insert into public.pools (season, name, created_by) values ('spon', 'Sponsored mates', '00000000-0000-0000-0000-00000000000a');
insert into public.pool_members (pool_id, user_id)
  select id, u from public.pools, unnest(array['00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b',
                                                '00000000-0000-0000-0000-00000000000c']::uuid[]) u
  where name = 'Sponsored mates' on conflict do nothing;
create temp table sp as select id from public.pools where name = 'Sponsored mates';
grant select on sp to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select not available and reason like 'Opens once 5 players%' from public.sponsor_quote((select id from sp))),
                     'a pool needs 5 players before it can be sponsored');
reset role;
insert into public.pool_members (pool_id, user_id)
  select (select id from sp), u from unnest(array['00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000e']::uuid[]) u
  on conflict do nothing;
-- A price that doesn't divide evenly, to prove the cents always add up.
insert into public.sponsor_prices values ('ZA', 'pool', 3, 150000, 100001);

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  perform public.create_sponsor('ZA', 'Lucky Bets', 'betting', 'bets@example.com');
  raise exception 'FAILED: a betting sponsor signed up';
exception when check_violation then raise notice 'ok: betting sponsors are refused';
end $$;
select public.create_sponsor('ZA', 'Van Zyl Motors', 'motoring', 'Paul@Example.com') as vz \gset
select pg_temp.check((select email from public.sponsors where id = :vz) = 'paul@example.com', 'a business sets up its sponsor account');
select pg_temp.check((select players = 5 and kind = 'pool' and price_minor = 150000 and available
                      from public.sponsor_quote((select id from sp))), 'the quote shows players, kind and price');
select public.hold_sponsor_slot(:vz, (select id from sp)) as bk \gset
select pg_temp.check((select own_school_minor = 30000 and partner_school_minor = 30000 and prize_minor = 30000 and scrumline_minor = 60000
                      from public.sponsor_bookings where id = :bk), 'the split is 20/20/20/40');
select public.hold_sponsor_slot(:vz, (select id from sp), 1) as bk1 \gset
select pg_temp.check((select own_school_minor + partner_school_minor + prize_minor + scrumline_minor = 100001 and scrumline_minor = 40001
                      from public.sponsor_bookings where id = :bk1), 'an odd price still adds up, remainder to Scrumline');
do $$ begin
  perform public.sponsor_booking_paid(1, 'paystack', 'x', 1, 'ZAR');
  raise exception 'FAILED: a player marked a booking paid';
exception when insufficient_privilege then raise notice 'ok: only the payment webhook can mark a booking paid';
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select public.create_sponsor('ZA', 'Rival Motors', 'motoring', 'rival@example.com') as rv \gset
do $$ begin
  perform public.hold_sponsor_slot(currval(pg_get_serial_sequence('public.sponsors', 'id')), (select id from sp));
  raise exception 'FAILED: two sponsors held one slot';
exception when raise_exception then raise notice 'ok: one sponsor per pool per season';
end $$;
select pg_temp.check((select count(*) from public.sponsor_bookings) = 0, 'a sponsor can''t see another sponsor''s bookings');
select pg_temp.check((select count(*) from public.sponsors) = 1, 'a sponsor sees only its own account');
do $$ begin
  perform public.hold_sponsor_slot((select min(id) from public.sponsors s0 where s0.name = 'Van Zyl Motors'), (select id from sp), 5);
  raise exception 'FAILED: booked for someone else''s sponsor account';
exception when insufficient_privilege then raise notice 'ok: nobody books in another sponsor''s name';
end $$;
select public.hold_sponsor_slot(:rv, (select id from sp), 2) as lapse \gset
reset role;
update public.sponsor_bookings set held_until = now() - interval '1 minute' where id = :lapse;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.hold_sponsor_slot(:vz, (select id from sp), 2) as bk2 \gset
select pg_temp.check(:bk2 > 0, 'an unpaid hold lapses after 30 minutes and frees the slot');
reset role;
select pg_temp.check((select status from public.sponsor_bookings where id = :lapse) = 'lapsed', 'the old hold is marked lapsed');
select pg_temp.check(public.sponsor_booking_paid(:lapse, 'paystack', 'late', 100001, 'ZAR') = 'slot taken while payment was pending',
                     'a late payment for a lost slot is flagged for refund');
select pg_temp.check((select status = 'refund_due' and provider_ref = 'late' from public.sponsor_bookings where id = :lapse),
                     'and recorded, so the money is traceable');

-- Payment, as the webhook would record it.
select pg_temp.check(public.sponsor_booking_paid(:bk, 'paystack', 'ref-1', 149999, 'ZAR') = 'amount mismatch', 'a wrong amount is refused');
select pg_temp.check(public.sponsor_booking_paid(:bk, 'paystack', 'ref-1', 150000, 'ZAR') = 'ok', 'the exact amount marks it paid');
select pg_temp.check(public.sponsor_booking_paid(:bk, 'paystack', 'ref-1', 150000, 'ZAR') = 'already paid', 'a repeated webhook is harmless');
select pg_temp.check((select status from public.sponsor_bookings where id = :bk) = 'paid', 'paid but not live before the creative is approved');
select pg_temp.check((select string_agg(coalesce(emis, 'fund') || ':' || share || ':' || amount_minor, ' ' order by share, emis nulls last)
                      from public.school_allocations where booking_id = :bk)
                     = '900000001:own:12000 900000002:own:6000 fund:own:12000 900000011:partner:12000 fund:partner:18000',
                     'schools get their players'' share, partners mirror it, no partner goes to the fund');
select pg_temp.check(public.sponsor_booking_paid(:bk1, 'paystack', 'ref-2', 100001, 'ZAR') = 'ok', 'the round booking is paid');
select pg_temp.check((select bool_and(t = 20000) from (select sum(amount_minor) t from public.school_allocations where booking_id = :bk1 group by share) x),
                     'uneven shares still add up to the cent');

-- The creative goes live only once approved.
select set_config('test.bk', :'bk', false);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ begin
  perform public.save_sponsor_creative(current_setting('test.bk')::bigint, 'Hijack', null, null, null);
  raise exception 'FAILED: changed another sponsor''s creative';
exception when insufficient_privilege then raise notice 'ok: only the sponsor edits its creative';
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check(public.save_sponsor_creative(:bk, 'Van Zyl Motors', 'Place your bets with us', null, null) = 'pending',
                     'a line with betting words waits for a person');
select pg_temp.check((select count(*) from public.pool_sponsors((select id from sp))) = 0, 'a flagged line never shows by itself');
select pg_temp.check(public.save_sponsor_creative(:bk, 'Van Zyl Motors', 'Paul Roos alumni: 15% off your next service', 'https://example.com', 'R500 service voucher') = 'approved',
                     'a clean name and line are approved automatically');
select pg_temp.check((select offer from public.pool_sponsors((select id from sp)) where round is null) like 'Paul Roos%', 'and go live with no one in the loop');
select public.save_sponsor_creative(:bk, 'Van Zyl Motors', 'Bet on us', null, null);
do $$ begin
  perform public.review_sponsor_creative(current_setting('test.bk')::bigint, true);
  raise exception 'FAILED: a sponsor approved itself';
exception when insufficient_privilege then raise notice 'ok: only admins approve creatives';
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.review_sponsor_creative(:bk, true);
select pg_temp.check((select count(*) from public.pool_sponsors((select id from sp))) = 1, 'an admin can pass a flagged line');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.save_sponsor_creative(:bk, 'Van Zyl Motors', 'Paul Roos alumni: 15% off your next service', 'https://example.com', 'R500 service voucher');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ff');
select pg_temp.check((select count(*) from public.pool_sponsors((select id from sp))) = 0, 'outsiders don''t see a pool''s sponsor');

-- Results: seen once per player per day, shares every time.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.sponsor_event(:bk, 'seen'); select public.sponsor_event(:bk, 'seen'); select public.sponsor_event(:bk, 'share');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select public.sponsor_event(:bk, 'seen'); select public.sponsor_event(:bk, 'share'); select public.sponsor_event(:bk, 'tap');
select pg_temp.check((select count(*) from public.sponsor_results(:bk)) = 0, 'players can''t read a sponsor''s results');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select reached = 2 and seen = 2 and shares = 2 and taps = 1 and own_due = 30000 and own_paid = 0
                      from public.sponsor_results(:bk)), 'the sponsor sees reach, shares, taps and money due to schools');
select pg_temp.check((select raised_minor = 12000 + 8000 from public.school_raised('900000001', 'spon')), 'a school page shows what it raised');
select pg_temp.check((select count(*) from public.my_sponsorships()) = 3, 'a sponsor lists its own bookings');
select pg_temp.check((select string_agg(school || ':' || amount_minor, ' ' order by share, amount_minor desc, school) from public.sponsor_allocations(:bk))
                     = 'Scrumline Schools Foundation fund:12000 Sponsor High One:12000 Sponsor High Two:6000 Scrumline Schools Foundation fund:18000 No-fee Twin:12000',
                     'a sponsor sees where its school money goes');
select pg_temp.check((select sum(seen) from public.sponsor_daily where booking_id = :bk) = 2, 'a sponsor reads its daily counts');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.sponsor_daily) = 0, 'but not anyone else''s');
select pg_temp.check((select string_agg(status, ',') from public.my_sponsorships()) = 'refund_due', 'a sponsor sees a payment that is owed back');
reset role;
insert into public.matches (id, season, round, kickoff_at, home_team_id, away_team_id, status, source) values
  ('sp1', 'spon', 1, now() - interval '1 day', '142072', '142073', 'FT', 'test'),
  ('sp2', 'spon', 2, now() + interval '2 days', '142072', '142073', 'SCHEDULED', 'test');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) >= 1 and bool_and(next_round = 2) from public.sponsor_slots('900000001', 'spon')),
                     'a business finds a school''s pools and the next open round');
reset role;
set role anon;
do $$ begin
  perform 1 from public.sponsor_bookings;
  raise exception 'FAILED: anon read bookings';
exception when insufficient_privilege then raise notice 'ok: signed-out visitors see no bookings';
end $$;
reset role;
update public.countries set open_to_sponsors = false where code = 'ZA';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  perform public.hold_sponsor_slot((select min(id) from public.sponsors), (select id from sp), 9);
  raise exception 'FAILED: booked in a closed country';
exception when raise_exception then raise notice 'ok: countries open to sponsors one at a time';
end $$;
reset role;
update public.countries set open_to_sponsors = true where code = 'ZA';

-- Sponsor rules that run themselves: school eligibility, one per category, renewal right
reset role;
update public.seasons set starts_on = '2026-12-01' where id = 'spon';
insert into public.schools (emis, name, town, province, no_fee, offers_primary, offers_matric, source) values
  ('900000021', 'Rules Primary', 'Stellenbosch', 'WC', false, true, false, 'test');
delete from public.school_vouches where stage = 'primary';
delete from public.member_schools where stage = 'primary';
insert into public.member_schools (user_id, stage, emis, last_year)
  select u, 'primary', '900000021', 2000 from unnest(array['00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b',
    '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000e']::uuid[]) u;
create temp table rp as select id, school_year from public.pools where season = 'spon' and school_emis = '900000021';
grant select on rp to authenticated;
select pg_temp.check((select count(*) from rp) = 2, 'the school and its class pool exist');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select reason like 'Opens once 5 players from the school%' from public.sponsor_quote((select id from rp where school_year is null))),
                     'a school opens to sponsors once 5 of its players are confirmed');
reset role;
-- Everyone vouched for by the two players after them.
insert into public.school_vouches (voucher_id, member_id, stage, emis)
  select v, m, 'primary', '900000021'
  from (select u, row_number() over (order by u) i from unnest(array['00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b',
          '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000e']::uuid[]) u) a(m, i)
  join (select u, row_number() over (order by u) i from unnest(array['00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b',
          '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000e']::uuid[]) u) b(v, i)
    on b.i in ((a.i % 5) + 1, ((a.i + 1) % 5) + 1);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select available from public.sponsor_quote((select id from rp where school_year is null))), 'with 5 confirmed, the school is open');
select public.hold_sponsor_slot(:vz, (select id from rp where school_year is null)) as rs \gset
reset role;
select pg_temp.check(public.sponsor_booking_paid(:rs, 'paystack', 'ref-rs', (select price_minor from public.sponsor_bookings where id = :rs), 'ZAR') = 'ok',
                     'the whole school is sponsored');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ begin
  perform public.hold_sponsor_slot((select id from public.sponsors where name = 'Rival Motors'), (select id from rp where school_year = 2000));
  raise exception 'FAILED: two car dealers on one school';
exception when raise_exception then
  if sqlerrm not like '%same line of business%' then raise; end if;
  raise notice 'ok: one business per category per school';
end $$;
select public.create_sponsor('ZA', 'Die Bank Coffee', 'food_drink', 'coffee@example.com') as cafe \gset
select pg_temp.check(public.hold_sponsor_slot(:cafe, (select id from rp where school_year = 2000)) > 0, 'a different kind of business can take a class');
reset role;
update public.schools set sponsor_optout = true where emis = '900000021';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select reason = 'This school isn''t taking sponsors' from public.sponsor_quote((select id from rp where school_year = 2000), 3)),
                     'a school that opts out is closed with one switch');
reset role;
update public.schools set sponsor_optout = false where emis = '900000021';

-- Next season: last season's sponsor has first right to renew.
insert into public.seasons (id, name, is_replay, competition_id, feed_season, starts_on) values ('spon2', 'Sponsor test 2', false, '5069', 'spon2', '2027-12-01');
insert into public.matches (id, season, round, kickoff_at, home_team_id, away_team_id, status, source) values
  ('sq1', 'spon2', 1, now() + interval '30 days', '142072', '142073', 'SCHEDULED', 'test');
create temp table rp2 as select id from public.pools where season = 'spon2' and school_emis = '900000021' and school_year is null;
grant select on rp2 to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select reason like 'Held for Van Zyl Motors to renew until%' from public.sponsor_quote((select id from rp2))),
                     'next season the slot is held for last season''s sponsor');
do $$ begin
  perform public.hold_sponsor_slot((select id from public.sponsors where name = 'Die Bank Coffee'), (select id from rp2));
  raise exception 'FAILED: someone took a slot during the renewal window';
exception when raise_exception then
  if sqlerrm not like 'Held for%' then raise; end if;
  raise notice 'ok: nobody else can take it while the renewal window is open';
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select available from public.sponsor_quote((select id from rp2))), 'the holder sees it as theirs to renew');
select pg_temp.check(public.hold_sponsor_slot(:vz, (select id from rp2)) > 0, 'and renews it');
reset role;
update public.matches set kickoff_at = now() + interval '10 days' where id = 'sq1';
delete from public.sponsor_bookings where pool_id = (select id from rp2);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select available from public.sponsor_quote((select id from rp2))), 'after the window closes, anyone can take it');

-- An extra donation on top: all of it reaches schools, none of it is Scrumline's
select public.hold_sponsor_slot(:cafe, (select id from rp2)) as ex \gset
select set_config('test.ex', :'ex', false);
select public.set_booking_donation(:ex, 50000);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  perform public.set_booking_donation(current_setting('test.ex')::bigint, 1);
  raise exception 'FAILED: someone else changed the donation';
exception when insufficient_privilege then raise notice 'ok: only the business sets its donation';
end $$;
reset role;
select pg_temp.check(public.sponsor_booking_paid(:ex, 'paystack', 'ref-ex', (select price_minor from public.sponsor_bookings where id = :ex), 'ZAR') = 'amount mismatch',
                     'paying only the price when a donation was added is refused');
select pg_temp.check(public.sponsor_booking_paid(:ex, 'paystack', 'ref-ex', (select price_minor + 50000 from public.sponsor_bookings where id = :ex), 'ZAR') = 'ok',
                     'the price plus the donation is accepted');
select pg_temp.check((select sum(amount_minor) from public.school_allocations where booking_id = :ex and share = 'own')
                     = (select own_school_minor + 50000 - 1750 from public.sponsor_bookings where id = :ex), 'the donation, less its 3.5% card fee, goes to the school');
select pg_temp.check(public.extra_card_fee(1) = 1 and public.extra_card_fee(100000) = 3500, 'the card fee on a donation rounds up to the cent');
select pg_temp.check((select scrumline_minor = price_minor - own_school_minor - partner_school_minor - prize_minor from public.sponsor_bookings where id = :ex),
                     'Scrumline''s share is the same with or without a donation');

-- Monday results email
reset role;
select pg_temp.check((select seen_week = 2 and players_week = 2 and shares_week = 2 and taps_week = 1 and schools_minor = 60000
                      from notify.due_sponsor_reports() where booking_id = :bk), 'each live sponsor has a weekly results email due');
insert into notify.sponsor_reports_sent (booking_id, week) select booking_id, week from notify.due_sponsor_reports() where booking_id = :bk;
select pg_temp.check(not exists (select 1 from notify.due_sponsor_reports() where booking_id = :bk), 'and gets it once a week');

-- Partner schools: nearest no-fee school at the same level, at most 3 each
reset role;
insert into public.schools (emis, name, town, province, no_fee, offers_primary, offers_matric, source, lat, lon) values
  ('900000041', 'Near No-fee Secondary', 'Paarl', 'WC', true, false, true, 'test', -33.93, 18.86),
  ('900000042', 'Far No-fee Secondary', 'Paarl', 'WC', true, false, true, 'test', -34.20, 18.90),
  ('900000031', 'Fee High A', 'Paarl', 'WC', false, false, true, 'test', -33.94, 18.87),
  ('900000032', 'Fee High B', 'Paarl', 'WC', false, false, true, 'test', -33.94, 18.87),
  ('900000033', 'Fee High C', 'Paarl', 'WC', false, false, true, 'test', -33.94, 18.87),
  ('900000034', 'Fee High D', 'Paarl', 'WC', false, false, true, 'test', -33.94, 18.87);
select public.match_partner_schools(1000);
select pg_temp.check((select string_agg(emis || '>' || partner_emis, ' ' order by emis) from public.school_partners where emis between '900000031' and '900000034')
                     = '900000031>900000041 900000032>900000041 900000033>900000041 900000034>900000042',
                     'each fee school gets the nearest no-fee partner, at most 3 per partner');
select pg_temp.check((select distance_km between 1 and 2 from public.school_partners where emis = '900000031'), 'the distance is kept');
select pg_temp.check(public.match_partner_schools(1000) = 0, 'matching again finds nothing left to do');
insert into public.schools (emis, name, town, province, no_fee, offers_primary, offers_matric, source, lat, lon) values
  ('900000051', 'Village No-fee Secondary', 'Village', 'WC', true, false, true, 'test', -33.000, 18.0),
  ('900000052', 'Across Town High', 'Village', 'WC', false, false, true, 'test', -33.200, 18.0),
  ('900000053', 'Next Door High 1', 'Village', 'WC', false, false, true, 'test', -33.001, 18.0),
  ('900000054', 'Next Door High 2', 'Village', 'WC', false, false, true, 'test', -33.001, 18.0),
  ('900000055', 'Next Door High 3', 'Village', 'WC', false, false, true, 'test', -33.001, 18.0);
select public.match_partner_schools(1000);
select pg_temp.check((select count(*) from public.school_partners where partner_emis = '900000051' and emis between '900000053' and '900000055') = 3
                     and not exists (select 1 from public.school_partners where emis = '900000052' and partner_emis = '900000051'),
                     'the closest schools are paired first, whatever order they were loaded in');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select name from public.school_partner('900000031')) = 'Near No-fee Secondary', 'a sponsor sees the partner by name');
reset role;

-- Business accounts: made by the sign-up function, sponsor pages only
reset role;
insert into auth.users (id, email, invited_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000b1', 'owner@specs.example.com', null, '{"kind":"business","business_name":"Specs Corner"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'selfmade@example.com', null, '{"kind":"business","business_name":"Sneaky"}');
update auth.users set invited_at = now() where id = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.check((select business_name from public.business_accounts where user_id = '00000000-0000-0000-0000-0000000000b1') = 'Specs Corner'
                     and not exists (select 1 from public.members where user_id = '00000000-0000-0000-0000-0000000000b1'),
                     'a business account is made, and no member');
select pg_temp.check(not exists (select 1 from public.business_accounts where user_id = '00000000-0000-0000-0000-0000000000b2'),
                     'an account nobody created for a business is not one');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.check(public.is_business() and not public.is_member(), 'the business is a business, not a member');
select pg_temp.check((select count(*) from public.schools) > 0 and (select count(*) from public.seasons) > 0, 'a business can find schools and tournaments');
select pg_temp.check((select count(*) from public.members) = 0 and (select count(*) from public.pools) = 0
                     and (select count(*) from public.predictions) = 0 and (select count(*) from public.chat_messages) = 0
                     and (select count(*) from public.member_schools) = 0 and (select count(*) from public.matches) = 0,
                     'a business sees no players, pools, calls, chat or schools people chose');
select pg_temp.check((select count(*) from public.sponsor_slots('900000001', 'spon')) >= 1, 'a business sees what a school has open');
select public.create_sponsor('ZA', 'Specs Corner', 'health', 'owner@specs.example.com') as specs \gset
select pg_temp.check(public.manages_sponsor(:specs), 'a business can set up its sponsor');
select set_config('test.specs', :'specs', false);
do $$ begin
  insert into public.business_accounts (user_id, business_name) values (auth.uid(), 'Other');
  raise exception 'FAILED: a business could write its own account row';
exception when insufficient_privilege then raise notice 'ok: a business cannot write account rows';
end $$;
do $$ begin
  perform public.send_business_link('x@example.com', 'X', 'https://example.com', false);
  raise exception 'FAILED: anyone could send sign-up emails';
exception when insufficient_privilege then raise notice 'ok: only the sign-up function sends its email';
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.business_accounts) = 0, 'players cannot see business accounts');
reset role;

-- Giving: money to schools per school and per sponsor, for players and businesses
reset role;
update public.school_allocations set status = 'confirmed' where id = (select min(a.id) from public.school_allocations a
  join public.sponsor_bookings b on b.id = a.booking_id and b.status in ('paid', 'live', 'ended'));
select sum(a.amount_minor) as want, sum(a.amount_minor) filter (where a.status = 'confirmed') as want_ok,
       count(distinct b.sponsor_id) as want_sp
from public.school_allocations a join public.sponsor_bookings b on b.id = a.booking_id and b.status in ('paid', 'live', 'ended') \gset
select pg_temp.check(:want > 0, 'giving test has paid sponsorships to count');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select committed_minor = :want and confirmed_minor = :want_ok and sponsors = :want_sp from public.giving_totals()),
                     'a player sees every rand committed to schools and what schools confirmed');
select pg_temp.check((select sum(committed_minor) from public.giving_schools()) = :want, 'the schools list adds up to the total');
select pg_temp.check((select sum(to_schools_minor) from public.giving_sponsors()) = :want, 'the sponsors list adds up to the total');
select pg_temp.check((select bool_and(v >= coalesce(nxt, 0)) from (select to_schools_minor v, lead(to_schools_minor) over () nxt from public.giving_sponsors()) x),
                     'sponsors are ranked by what they gave schools');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select committed_minor from public.giving_totals()) = :want, 'a business sees the same totals');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ff');
select pg_temp.check((select committed_minor from public.giving_totals()) = 0 and not exists (select 1 from public.giving_schools()),
                     'an account that is neither player nor business sees nothing');
do $$ begin
  perform * from public.giving_rows(null, 'ZAR');
  raise exception 'FAILED: the raw giving rows are open';
exception when insufficient_privilege then raise notice 'ok: the raw giving rows stay closed';
end $$;
reset role;

-- Business profiles: logo, a few lines and a website, edited by the business only
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select public.save_sponsor_profile(:specs, 'Specs Corner', 'Family optometrists in Makhanda since 1998.', 'https://specscorner.example.com', :specs || '/logo-1.png');
select pg_temp.check((select about = 'Family optometrists in Makhanda since 1998.' and website like 'https://%' and logo_path = :specs || '/logo-1.png'
                      from public.sponsors where id = :specs), 'a business saves its profile');
do $$ begin
  perform public.save_sponsor_profile(current_setting('test.specs')::bigint, 'Specs Corner', 'Best odds, bet now', null, null);
  raise exception 'FAILED: betting words got into a profile';
exception when invalid_parameter_value then raise notice 'ok: words the check catches are refused on the spot';
end $$;
do $$ begin
  perform public.save_sponsor_profile(current_setting('test.specs')::bigint, 'Specs Corner', null, null, '1/logo.png');
  raise exception 'FAILED: a profile pointed at another business''s logo';
exception when check_violation then raise notice 'ok: a logo must sit in the business''s own folder';
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  perform public.save_sponsor_profile(current_setting('test.specs')::bigint, 'Hijacked', null, null, null);
  raise exception 'FAILED: someone else edited the profile';
exception when insufficient_privilege then raise notice 'ok: only the business edits its profile';
end $$;
reset role;

-- Schools claim themselves: bank name must match, a week's notice, then monthly payouts
reset role; select set_config('request.jwt.claim.sub', '', false);
select emis as sch from public.school_allocations where booking_id = :ex and share = 'own' and emis is not null order by amount_minor desc limit 1 \gset
select set_config('test.sch', :'sch', false);
insert into auth.users (id, email, invited_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 'bursar@school.example.com', now(), '{"kind":"school","contact_name":"Mrs Dlamini","role":"bursar"}');
select pg_temp.check((select contact_name = 'Mrs Dlamini' and role = 'bursar' from public.school_accounts where user_id = '00000000-0000-0000-0000-0000000000c1'),
                     'the sign-up makes a school account, not a member');
select pg_temp.check(not exists (select 1 from public.members where user_id = '00000000-0000-0000-0000-0000000000c1'), 'a school account is not a player');
select pg_temp.check(public.school_name_words('Hoërskool Paul Roos Gimnasium SGB Trust') = '{paul,roos,gimnasium}', 'common school words do not count');
select pg_temp.check(public.record_school_claim('00000000-0000-0000-0000-0000000000c1', 'FNB', '1234', 'X', true, 'RCP_x') = 'pick your school first',
                     'a claim needs a school');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select public.set_school_account_school(:'sch');
select pg_temp.check((select count(*) from public.members) = 0, 'a school account sees no players');
reset role; select set_config('request.jwt.claim.sub', '', false);
select pg_temp.check(public.record_school_claim('00000000-0000-0000-0000-0000000000c1', 'FNB', '1234', 'Someone Else Trading', true, 'RCP_x') = 'needs_review',
                     'an account in another name waits for a person');
select id as cl from public.school_claims where emis = :'sch' \gset
select pg_temp.check(public.record_school_claim('00000000-0000-0000-0000-0000000000c1', 'FNB', '1234', 'Someone', true, 'RCP_y') = 'already claimed by you',
                     'one live claim per school');
select public.review_school_claim(:cl, false, 'Not the school''s account');
select pg_temp.check(public.record_school_claim('00000000-0000-0000-0000-0000000000c1', 'FNB', '5678',
                     (select name from public.schools where emis = :'sch') || ' SGB', true, 'RCP_ok') = 'verified',
                     'the school''s own name on a confirmed account is verified at once');
select id as cl from public.school_claims where emis = :'sch' and status = 'verified' \gset
select pg_temp.check((select notice_until > now() + interval '6 days' from public.school_claims where id = :cl), 'and goes on a week''s notice');
update public.sponsor_bookings set paid_at = now() - interval '8 days' where id = :ex;
select pg_temp.check(public.make_school_payouts() = 0, 'no payouts during the notice');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.check((select raised_minor > 0 and waiting_minor = raised_minor and claim_status = 'verified' and account_last4 = '5678'
                      from public.school_dashboard()), 'the school sees what it raised and its claim');
select pg_temp.check((select count(*) from public.school_claims) = 2, 'the school account sees only its own claims');
reset role; select set_config('request.jwt.claim.sub', '', false);
-- A player from the school flags it; payouts stop until an admin looks.
insert into public.member_schools (user_id, stage, emis)
  select '00000000-0000-0000-0000-00000000000e', case when offers_matric then 'high' else 'primary' end, emis from public.schools where emis = :'sch'
  on conflict (user_id, stage) do update set emis = excluded.emis;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select pg_temp.check((select contact_name = 'Mrs Dlamini' from public.school_claim_info(:'sch')), 'players from the school see who claimed it');
select public.flag_school_claim(:cl, 'She left the school last year');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
do $$ begin
  perform public.flag_school_claim((select id from public.school_claims where emis = current_setting('test.sch') and status = 'needs_review'), 'Trouble');
  raise exception 'FAILED: a stranger flagged another school';
exception when insufficient_privilege then raise notice 'ok: only players from the school can flag it';
end $$;
reset role; select set_config('request.jwt.claim.sub', '', false);
update public.school_claims set notice_until = now() - interval '1 minute' where id = :cl;
select pg_temp.check(public.make_school_payouts() = 0, 'a flagged claim is not paid');
select pg_temp.check((select count(*) from public.admin_school_queue() where kind = 'review' and id = :cl) = 1, 'the flag lands in the admin queue');
select public.review_school_claim(:cl, true, 'Called the school: she is the bursar');
update public.school_claims set notice_until = now() - interval '1 minute' where id = :cl;
select pg_temp.check(public.make_school_payouts() = 1, 'after the notice, the month''s payout is made');
select id as po from public.school_payouts where claim_id = :cl \gset
select pg_temp.check((select amount_minor from public.school_payouts where id = :po)
                     = (select sum(amount_minor) from public.school_allocations where emis = :'sch' and payout_id = :po), 'it adds up the school''s shares');
select pg_temp.check(public.make_school_payouts() = 0, 'and a share is paid out once');
select reference as ref from public.school_payouts where id = :po \gset
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
do $$ begin
  perform public.confirm_school_payout((select id from public.school_payouts limit 1));
  raise exception 'FAILED: confirmed before the money arrived';
exception when raise_exception then raise notice 'ok: a payment is confirmed only after it arrives';
end $$;
reset role; select set_config('request.jwt.claim.sub', '', false);
select pg_temp.check(public.school_payout_result(:'ref', false, 'TRF_1', 'Account closed') = 'failed', 'a failed transfer is recorded');
select pg_temp.check(not exists (select 1 from public.school_allocations where payout_id = :po), 'and its shares wait for next month');
select pg_temp.check(public.make_school_payouts() = 1, 'next month they are paid again');
select id as po, reference as ref from public.school_payouts where claim_id = :cl and status = 'pending' \gset
select pg_temp.check(public.school_payout_result(:'ref', true, 'TRF_2', null) = 'ok', 'a transfer that lands marks the shares paid');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select public.confirm_school_payout(:po);
reset role; select set_config('request.jwt.claim.sub', '', false);
select pg_temp.check((select bool_and(status = 'confirmed') from public.school_allocations where payout_id = :po), 'the school confirms it and Giving shows it');

-- Schools looked after by a person: goods instead of cash, confirmed by WhatsApp
reset role; select set_config('request.jwt.claim.sub', '', false);
select emis as nf from public.schools where no_fee and emis <> :'sch' and not exists (select 1 from public.school_claims c where c.emis = schools.emis) limit 1 \gset
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  perform public.assisted_goods_claim((select emis from public.schools where no_fee limit 1), 'Mr Mthembu', 'principal', '+27 82 000 0000', 'xh');
  raise exception 'FAILED: a player made an assisted claim';
exception when insufficient_privilege then raise notice 'ok: only admins record schools they look after';
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.assisted_goods_claim(:'nf', 'Mr Mthembu', 'principal', '+27 82 000 0000', 'xh') as gc \gset
reset role; select set_config('request.jwt.claim.sub', '', false);
select pg_temp.check((select status = 'verified' and payout_mode = 'goods' and language = 'xh' from public.school_claims where id = :gc),
                     'an admin records a school that takes goods, in isiXhosa');
insert into public.school_payouts (emis, claim_id, amount_minor, currency) values (:'nf', :gc, 50000, 'ZAR') returning id as gp \gset
select pg_temp.check((select count(*) from public.admin_school_queue() where kind = 'deliver' and id = :gp) = 1, 'goods to buy show in the queue');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.record_goods_delivered(:gp, '15 rugby balls and a kit bag, delivered 3 Oct');
select public.confirm_assisted_payout(:gp, 'WhatsApp photo from the principal');
reset role; select set_config('request.jwt.claim.sub', '', false);
select pg_temp.check((select status = 'confirmed' and note like '15 rugby balls%Confirmed: WhatsApp photo%' from public.school_payouts where id = :gp),
                     'delivery and the school''s confirmation are both on record');

-- The money log: every change is written down and nothing can rub it out
select pg_temp.check((select count(*) from public.money_log where entity = 'school_payouts' and entity_id = :gp) >= 3,
                     'each step of a payout is in the money log');
do $$ begin
  delete from public.money_log;
  raise exception 'FAILED: the money log was wiped';
exception when insufficient_privilege then raise notice 'ok: nobody can delete from the money log';
end $$;
do $$ begin
  update public.money_log set new = null where id = (select min(id) from public.money_log);
  raise exception 'FAILED: the money log was edited';
exception when insufficient_privilege then raise notice 'ok: nobody can edit the money log';
end $$;
-- Tidy two test shortcuts (a share marked confirmed by hand for Giving, a goods payout with no shares) before the sums.
update public.school_allocations set status = 'due' where status <> 'due' and payout_id is null;
delete from public.school_payouts where id = :gp;
select pg_temp.check((select string_agg(check_name, '; ') from public.money_checks() where not ok) is null, 'every money sum holds to the cent');
update public.school_allocations set amount_minor = amount_minor + 1 where id = (select min(id) from public.school_allocations where payout_id = :po);
select pg_temp.check((select problems from public.money_checks() where check_name like 'Every rand%') = 1
                     and (select not ok from public.money_checks() where check_name like 'Each payout%'), 'a cent out of place is caught');
update public.school_allocations set amount_minor = amount_minor - 1 where id = (select min(id) from public.school_allocations where payout_id = :po);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.admin_money_checks()) = 0, 'only admins see the money checks');
reset role; select set_config('request.jwt.claim.sub', '', false);

-- Outreach: schools owed money with nobody to pay, and a second contact told who looks after a school
reset role; select set_config('request.jwt.claim.sub', '', false);
select pg_temp.check((select count(*) from public.admin_unclaimed_owed() where emis = :'sch') = 0, 'a claimed school is not on the call list');
update public.school_claims set status = 'revoked' where id = :cl;
select pg_temp.check((select owed_minor > 0 from public.admin_unclaimed_owed() where emis = :'sch'), 'once nobody looks after it, what it is owed shows on the call list');
update public.school_claims set status = 'verified' where id = :cl;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.admin_unclaimed_owed()) = 0, 'only admins see the call list');
select pg_temp.check((select count(*) from public.school_claim_holder(:'sch')) = 0, 'players do not use the holder lookup');
reset role; select set_config('request.jwt.claim.sub', '', false);
insert into auth.users (id, email, invited_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c2', 'principal@school.example.com', now(), '{"kind":"school","contact_name":"Mr Petersen","role":"principal"}');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select pg_temp.check((select contact_name = 'Mrs Dlamini' and role = 'bursar' from public.school_claim_holder(:'sch')), 'a second contact is told who looks after the school');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.check((select count(*) from public.school_claim_holder(:'sch')) = 0, 'the holder is not told about themselves');
reset role; select set_config('request.jwt.claim.sub', '', false);

\echo ALL CHECKS PASSED
