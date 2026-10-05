-- Knockout rounds: the URC playoffs (and any tournament's finals) load
-- themselves and read as "Quarter-finals", "Semi-finals", "Final".
--
-- TheSportsDB numbers knockout rounds 125 (quarter-finals), 150
-- (semi-finals), 160 (third-place play-off) and 200 (final), and only lists
-- the matches once the teams are known, under new ids that don't follow the
-- league fixtures. The daily "next ten ids" check therefore never finds
-- them. Instead, once a tournament's last loaded match is three weeks away
-- (or played in the last six weeks), a daily job asks for those rounds and
-- for the round after the last one loaded; from then on request_live()
-- follows the matches by id like any other.
--
-- Messages that name a round (round openers, kickoff reminder sponsor line,
-- prize pushes) now use round_name()/round_text(); each function below is
-- its live definition with only that change.

create or replace function public.round_name(p_round integer)
returns text language sql immutable set search_path = '' as $$
  select case p_round when 125 then 'Quarter-finals' when 150 then 'Semi-finals'
                      when 160 then 'Third-place play-off' when 200 then 'Final'
                      else 'Round ' || p_round end
$$;
create or replace function public.round_text(p_round integer)
returns text language sql immutable set search_path = '' as $$
  select case p_round when 125 then 'the quarter-finals' when 150 then 'the semi-finals'
                      when 160 then 'the third-place play-off' when 200 then 'the final'
                      else 'round ' || p_round end
$$;

create or replace function raw.request_knockouts(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = 'public', 'raw'
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
    where not s.is_replay
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
revoke all on function raw.request_knockouts(timestamptz) from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('feed-request-knockouts', '10 3 * * *', 'select raw.request_knockouts()');
  end if;
end $$;

-- notify.send_reminders: as in 20260928001500_reminder_sponsor.sql, round names only.
create or replace function notify.send_reminders()
returns int
language plpgsql
security definer
set search_path = public, notify
as $$
declare
  key text;
  d record;
  rid bigint;
  n int := 0;
  pushed int := 0;
  cfg jsonb := (select jsonb_object_agg(s.key, s.value) from notify.settings s);
  push_on boolean := exists (select 1 from notify.settings s where s.key = 'vapid_public_key');
  sp record;
  thanks text;
begin
  select decrypted_secret into key from vault.decrypted_secrets where name = 'brevo_api_key';
  for d in select * from notify.due_reminders() loop
    rid := null;
    select * into sp from notify.reminder_sponsor(d.user_id, d.match_ids[1]);
    thanks := case when sp.booking_id is null then ''
                   when sp.round is not null then ' ' || public.round_name(sp.round) || ' is brought to you by ' || sp.name || '.'
                   else ' Brought to you by ' || sp.name || '.' end;
    if push_on
       and exists (select 1 from public.members mb where mb.user_id = d.user_id and mb.reminder_by = 'push')
       and exists (select 1 from public.push_subscriptions ps where ps.user_id = d.user_id) then
      insert into notify.push_outbox (user_id, title, body, url, tag)
      values (d.user_id,
              case when cardinality(d.match_ids) = 1 then 'Kickoff in under an hour'
                   else 'Kickoff in under an hour: ' || cardinality(d.match_ids) || ' scores to call' end,
              'You haven''t called ' || array_to_string(d.lines, ', ') || '. It locks at kickoff.' || thanks,
              cfg ->> 'app_url',
              'kickoff');
      pushed := pushed + 1;
      if sp.booking_id is not null then perform notify.sponsor_reached(sp.booking_id, d.user_id); end if;
    elsif key is not null then
      rid := net.http_post(
        url := 'https://api.brevo.com/v3/smtp/email',
        headers := jsonb_build_object('api-key', key, 'content-type', 'application/json', 'accept', 'application/json'),
        body := jsonb_build_object(
          'sender', jsonb_build_object('email', cfg ->> 'sender_email', 'name', cfg ->> 'sender_name'),
          'to', jsonb_build_array(jsonb_build_object('email', d.email, 'name', d.display_name)),
          'subject', case when cardinality(d.match_ids) = 1 then 'Kickoff in under an hour: call your score'
                          else 'Kickoff in under an hour: ' || cardinality(d.match_ids) || ' scores to call' end,
          'htmlContent',
            '<p>Hi ' || replace(replace(replace(d.display_name, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || ',</p>'
            || '<p>You haven''t called a score for:</p><ul><li>'
            || array_to_string(d.lines, '</li><li>')
            || '</li></ul><p>Times are SA time. <a href="' || (cfg ->> 'app_url') || '">Call it now</a> before it locks at kickoff.</p>'
            || case when sp.booking_id is null then ''
                    else '<p>' || case when sp.round is not null then public.round_name(sp.round) || ' is brought to you by '
                                       else 'Brought to you by ' end
                         || '<b>' || replace(replace(replace(sp.name, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</b>.</p>' end
            || '<p style="color:#888;font-size:12px">You can turn these off, or switch them to your phone, on your profile.</p>'
        )
      );
    else
      continue;
    end if;
    insert into notify.reminders_sent (user_id, match_id, request_id)
    select d.user_id, x, rid from unnest(d.match_ids) x
    on conflict do nothing;
    n := n + 1;
  end loop;
  if pushed > 0 then perform notify.kick_push(); end if;
  return n;
end;
$$;

-- public.post_prize_notices: as in 20261004000300_prize_win_pushes.sql, round names only.
create or replace function public.post_prize_notices()
returns integer
language plpgsql security definer
set search_path = public
as $$
declare n integer;
begin
  with won as (
    insert into public.chat_notices (pool_id, kind, round, winners, prize, sponsor)
    select rp.pool_id, 'prize_won', rp.round, o.winners, rp.prize, rp.sponsor
    from public.round_prizes rp
    cross join lateral public.prize_outcome(rp.pool_id, rp.round) o
    where o.complete and cardinality(o.winners) > 0
      and public.pool_has_chat(rp.pool_id)
      and not exists (select 1 from public.chat_notices c
                      where c.pool_id = rp.pool_id and c.kind = 'prize_won' and c.round = rp.round)
    on conflict do nothing
    returning pool_id, round, winners, prize, sponsor
  ), winners as (
    insert into notify.push_outbox (user_id, title, body, url, tag)
    select w.uid, 'You won ' || public.round_text(won.round) || '''s prize 🏆',
           won.prize || coalesce(' from ' || won.sponsor, '') || '. They''ll be in touch to get it to you.',
           notify.app_link('leaderboard/?pool=' || won.pool_id), 'prize-' || won.pool_id || '-' || won.round
    from won cross join lateral unnest(won.winners) w(uid)
    where exists (select 1 from public.push_subscriptions s where s.user_id = w.uid)
  ), givers as (
    insert into notify.push_outbox (user_id, title, body, url, tag)
    select rp.offered_by,
           (select string_agg(m.display_name, ' & ') from public.members m where m.user_id = any (won.winners))
             || ' won your ' || public.round_text(won.round) || ' prize',
           'Get the ' || won.prize || ' to them within 14 days. They tap Received once they have it.',
           notify.app_link('sponsor/prizes/'), 'prize-give-' || won.pool_id || '-' || won.round
    from won join public.round_prizes rp on rp.pool_id = won.pool_id and rp.round = won.round
    where not (rp.offered_by = any (won.winners))
      and exists (select 1 from public.push_subscriptions s where s.user_id = rp.offered_by)
  )
  select count(*) into n from won;
  return n;
end $$;


-- notify.prize_message_push: as in 20261004000400_prize_messages.sql, round names only.
create or replace function notify.prize_message_push()
returns trigger
language plpgsql security definer
set search_path = public, notify
as $$
begin
  insert into notify.push_outbox (user_id, title, body, url, tag)
  select u, a.display_name || ' · ' || public.round_text(new.round) || ' prize',
         case when length(new.body) > 140 then left(new.body, 139) || '…' else new.body end,
         notify.app_link('leaderboard/?pool=' || new.pool_id || '&prize=' || new.round),
         'prize-msg-' || new.pool_id || '-' || new.round
  from unnest(public.prize_party(new.pool_id, new.round)) u, public.members a
  where a.user_id = new.author_id and u <> new.author_id
    and exists (select 1 from public.push_subscriptions s where s.user_id = u);
  return null;
end $$;

-- notify.send_round_openers: as in 20261005000300_round_openers.sql, round names only.
create or replace function notify.send_round_openers()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  key text;
  d record;
  rid bigint;
  ch text;
  n integer := 0;
  pushed integer := 0;
  cfg jsonb := (select jsonb_object_agg(s.key, s.value) from notify.settings s);
  push_on boolean := exists (select 1 from notify.settings s where s.key = 'vapid_public_key');
  head text;
  body text;
  esc text;
begin
  select decrypted_secret into key from vault.decrypted_secrets where name = 'brevo_api_key';
  for d in select * from notify.due_round_openers() loop
    rid := null;
    head := case when d.missed_last then public.round_name(d.round) || ' is a fresh start'
                 else public.round_name(d.round) || ' starts tomorrow' end;
    body := 'First kickoff ' || to_char(d.first_ko at time zone 'Africa/Johannesburg', 'Dy HH24:MI')
            || ', ' || d.matches || ' games to call in the ' || d.season_name || '.'
            || case when d.missed_last then ' Last round slipped by, but your Banker can double a game this one.'
                    else ' Call them now and pick your Banker.' end;
    if push_on
       and exists (select 1 from public.members mb where mb.user_id = d.user_id and mb.reminder_by = 'push')
       and exists (select 1 from public.push_subscriptions ps where ps.user_id = d.user_id) then
      insert into notify.push_outbox (user_id, title, body, url, tag)
      values (d.user_id, head, body, cfg ->> 'app_url', 'round-opener');
      ch := 'push';
      pushed := pushed + 1;
    elsif key is not null then
      esc := replace(replace(replace(d.display_name, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
      rid := net.http_post(
        url := 'https://api.brevo.com/v3/smtp/email',
        headers := jsonb_build_object('api-key', key, 'content-type', 'application/json', 'accept', 'application/json'),
        body := jsonb_build_object(
          'sender', jsonb_build_object('email', cfg ->> 'sender_email', 'name', cfg ->> 'sender_name'),
          'to', jsonb_build_array(jsonb_build_object('email', d.email, 'name', d.display_name)),
          'subject', head,
          'htmlContent',
            '<p>Hi ' || esc || ',</p><p>' || body || '</p>'
            || '<p>Times are SA time. <a href="' || (cfg ->> 'app_url') || '">Call your scores</a>.</p>'
            || '<p style="color:#888;font-size:12px">You can turn these off, or switch them to your phone, on your profile.</p>'
        )
      );
      ch := 'email';
    else
      continue;
    end if;
    insert into notify.round_nudges (user_id, season, round, channel, request_id)
    values (d.user_id, d.season, d.round, ch, rid)
    on conflict do nothing;
    perform analytics.emit(d.user_id, 'nudge_sent', d.season, null,
                           jsonb_build_object('round', d.round, 'channel', ch, 'fresh_start', d.missed_last));
    n := n + 1;
  end loop;
  if pushed > 0 then perform notify.kick_push(); end if;
  return n;
end;
$$;
