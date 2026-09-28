-- Kickoff reminders name the pool's sponsor.
--
-- The reminder is the one message every player reads, so a sponsor's name
-- in it is worth far more than a line on a screen they may not open. A
-- player in several sponsored pools gets one sponsor: a round sponsor
-- before a season one, then the smallest pool (the most personal), then
-- the longest-standing booking. A push counts as the sponsor being seen by
-- that player that day, like opening the app; an email doesn't, because
-- nobody can tell whether it was read.

create or replace function notify.reminder_sponsor(p_user uuid, p_match text)
returns table (booking_id bigint, round int, name text)
language sql stable
security definer
set search_path = public, notify
as $$
  select b.id, b.round, c.display_name
  from public.matches m
  join public.pool_members pm on pm.user_id = p_user
  join public.pools p on p.id = pm.pool_id and p.season = m.season
  join public.sponsor_bookings b on b.pool_id = p.id and b.status = 'live'
                                 and (b.round is null or b.round = m.round)
  join public.sponsors s on s.id = b.sponsor_id and not s.blocked
  join public.sponsor_creatives c on c.booking_id = b.id and c.status = 'approved'
  where m.id = p_match
  order by (b.round is null), (select count(*) from public.pool_members x where x.pool_id = p.id), b.id
  limit 1
$$;
revoke all on function notify.reminder_sponsor(uuid, text) from public, anon, authenticated;

create or replace function notify.sponsor_reached(p_booking bigint, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, notify
as $$
declare
  today date := (now() at time zone 'Africa/Johannesburg')::date;
  fresh int;
begin
  insert into public.sponsor_sightings (booking_id, user_id, day) values (p_booking, p_user, today)
  on conflict do nothing;
  get diagnostics fresh = row_count;
  if fresh = 0 then return; end if;
  insert into public.sponsor_daily (booking_id, day, seen) values (p_booking, today, 1)
  on conflict (booking_id, day) do update set seen = public.sponsor_daily.seen + 1;
end $$;
revoke all on function notify.sponsor_reached(bigint, uuid) from public, anon, authenticated;

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
                   when sp.round is not null then ' Round ' || sp.round || ' is brought to you by ' || sp.name || '.'
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
                    else '<p>' || case when sp.round is not null then 'Round ' || sp.round || ' is brought to you by '
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
revoke all on function notify.send_reminders() from public, anon, authenticated;
