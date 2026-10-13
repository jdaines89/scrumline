-- Banker reminder: one nudge, about two hours before a round's first kickoff,
-- to a player who has called every game in it but not picked a Banker. The
-- kickoff reminders only name games with no call, so a player with everything
-- saved heard nothing and played the round without their double.
--
-- Same rules as the round openers: only players with reminders on; push when
-- they chose it and have a phone signed up, email otherwise; never twice for
-- the same round (notify.banker_nudges).
create table if not exists notify.banker_nudges (
  user_id    uuid    not null references public.members(user_id) on delete cascade,
  season     text    not null references public.seasons(id),
  round      integer not null,
  sent_at    timestamptz not null default now(),
  channel    text    not null check (channel in ('push', 'email')),
  request_id bigint,
  primary key (user_id, season, round)
);
revoke all on notify.banker_nudges from public, anon, authenticated;

-- Rounds that have not started and whose first kickoff is under 2 hours away,
-- and who has a call on every game in them but no Banker.
create or replace function notify.due_banker_nudges(p_now timestamptz default now())
returns table (user_id uuid, email text, display_name text, season text, season_name text,
               round integer, first_ko timestamptz)
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
       and min(m.kickoff_at) > p_now and min(m.kickoff_at) <= p_now + interval '2 hours'
  )
  select mb.user_id, mb.email, mb.display_name, r.season, s.name, r.round, r.first_ko
  from rounds r
  join public.seasons s on s.id = r.season
  join public.members mb on mb.email_reminders
  join public.entries e on e.user_id = mb.user_id and e.season = r.season
  where (select count(*) from public.predictions pr join public.matches m on m.id = pr.match_id
         where pr.entry_id = e.id and m.season = r.season and m.round = r.round) = r.matches
    and not exists (select 1 from public.predictions pr join public.matches m on m.id = pr.match_id
                    where pr.entry_id = e.id and m.season = r.season and m.round = r.round and pr.is_banker)
    and not exists (select 1 from notify.banker_nudges n
                    where n.user_id = mb.user_id and n.season = r.season and n.round = r.round)
$$;
revoke all on function notify.due_banker_nudges(timestamptz) from public, anon, authenticated;

create or replace function notify.send_banker_nudges()
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
  for d in select * from notify.due_banker_nudges() loop
    rid := null;
    head := 'Pick your Banker for Round ' || d.round;
    body := 'Every game is called, but no Banker yet. Back one match and it counts double. First kickoff '
            || to_char(d.first_ko at time zone 'Africa/Johannesburg', 'Dy HH24:MI') || '.';
    if push_on
       and exists (select 1 from public.members mb where mb.user_id = d.user_id and mb.reminder_by = 'push')
       and exists (select 1 from public.push_subscriptions ps where ps.user_id = d.user_id) then
      insert into notify.push_outbox (user_id, title, body, url, tag)
      values (d.user_id, head, body, cfg ->> 'app_url', 'banker-nudge');
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
            || '<p>Times are SA time. <a href="' || (cfg ->> 'app_url') || '">Pick your Banker</a>.</p>'
            || '<p style="color:#888;font-size:12px">You can turn these off, or switch them to your phone, on your profile.</p>'
        )
      );
      ch := 'email';
    else
      continue;
    end if;
    insert into notify.banker_nudges (user_id, season, round, channel, request_id)
    values (d.user_id, d.season, d.round, ch, rid)
    on conflict do nothing;
    perform analytics.emit(d.user_id, 'nudge_sent', d.season, null,
                           jsonb_build_object('round', d.round, 'channel', ch, 'kind', 'banker'));
    n := n + 1;
  end loop;
  if pushed > 0 then perform notify.kick_push(); end if;
  return n;
end;
$$;
revoke all on function notify.send_banker_nudges() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    -- Every 15 minutes; the 2-hour window means each round is caught once.
    perform cron.schedule('banker-nudges', '5,20,35,50 * * * *', 'select notify.send_banker_nudges()');
  end if;
end $$;
