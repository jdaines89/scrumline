-- Round opener: one nudge the day before a round starts, to players who
-- haven't called any of it yet. The kickoff reminders only fire an hour
-- before each match, which is late for anyone who forgot the round was on.
-- Players who missed the whole previous round get a "fresh start" message,
-- so a missed weekend doesn't turn into a player lost for good.
--
-- Same rules as the kickoff reminders: only players in that tournament with
-- reminders on; push when they chose it and have a phone signed up, email
-- otherwise; never twice for the same round (notify.round_nudges).
create table if not exists notify.round_nudges (
  user_id    uuid    not null references public.members(user_id) on delete cascade,
  season     text    not null references public.seasons(id),
  round      integer not null,
  sent_at    timestamptz not null default now(),
  channel    text    not null check (channel in ('push', 'email')),
  request_id bigint,
  primary key (user_id, season, round)
);
revoke all on notify.round_nudges from public, anon, authenticated;

-- Rounds whose first kickoff is 18 to 30 hours away, and who still has
-- nothing called in them.
create or replace function notify.due_round_openers(p_now timestamptz default now())
returns table (user_id uuid, email text, display_name text, season text, season_name text,
               round integer, first_ko timestamptz, matches integer, missed_last boolean)
language sql stable
set search_path = ''
as $$
  with rounds as (
    select m.season, m.round, min(m.kickoff_at) as first_ko, count(*)::integer as matches
    from public.matches m
    join public.seasons s on s.id = m.season and not s.is_replay
    where m.round is not null
    group by m.season, m.round
    having bool_and(m.status = 'SCHEDULED')
       and min(m.kickoff_at) between p_now + interval '18 hours' and p_now + interval '30 hours'
  )
  select mb.user_id, mb.email, mb.display_name, r.season, s.name, r.round, r.first_ko, r.matches,
         -- Had a team for the last round, called none of it.
         exists (select 1 from public.matches pm where pm.season = r.season and pm.round = r.round - 1)
         and not exists (select 1 from public.predictions pr
                         join public.entries e on e.id = pr.entry_id and e.user_id = mb.user_id and e.season = r.season
                         join public.matches pm on pm.id = pr.match_id and pm.round = r.round - 1)
         and exists (select 1 from public.entries e where e.user_id = mb.user_id and e.season = r.season
                     and e.created_at < (select min(pm.kickoff_at) from public.matches pm
                                         where pm.season = r.season and pm.round = r.round - 1))
  from rounds r
  join public.seasons s on s.id = r.season
  join public.members mb on mb.email_reminders
    and (exists (select 1 from public.pool_members pm join public.pools p on p.id = pm.pool_id
                 where pm.user_id = mb.user_id and p.season = r.season)
         or exists (select 1 from public.entries e where e.user_id = mb.user_id and e.season = r.season))
  where not exists (select 1 from public.predictions pr
                    join public.entries e on e.id = pr.entry_id and e.user_id = mb.user_id and e.season = r.season
                    join public.matches m on m.id = pr.match_id and m.round = r.round)
    and not exists (select 1 from notify.round_nudges n
                    where n.user_id = mb.user_id and n.season = r.season and n.round = r.round)
$$;
revoke all on function notify.due_round_openers(timestamptz) from public, anon, authenticated;

insert into analytics.event_names (name, source, description) values
  ('nudge_sent', 'server', 'A round-opener nudge went out (props: round, channel, fresh_start)')
on conflict (name) do nothing;

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
    head := case when d.missed_last then 'Round ' || d.round || ' is a fresh start'
                 else 'Round ' || d.round || ' starts tomorrow' end;
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
revoke all on function notify.send_round_openers() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    -- Hourly; the 18-30 hour window means each round is caught once, the evening or morning before.
    perform cron.schedule('round-openers', '20 * * * *', 'select notify.send_round_openers()');
  end if;
end $$;
