-- Growth sprint: more people calling every week, in more leagues.
--
-- 1. After a round's results are in, Home shows how you did in your biggest
--    mates' league, with one tap to bring someone else into it
--    (public.after_round).
-- 2. Whoever started a league sees who has called the next round, so they
--    can nudge the rest on WhatsApp (public.organiser_round). Counts only,
--    never anyone's scores.
-- 3. Admins get one line each Monday morning: how many called last week,
--    against the sprint target of 100 a week by 29 November
--    (notify.send_growth_line, cron 'growth-line').
--
-- Additive only.

-- Your last finished round in a tournament, and your biggest mates' league in it.
create or replace function public.after_round(p_season text, p_now timestamptz default now())
returns jsonb
language sql stable
security definer
set search_path = ''
as $$
  with r as (
    select m.round, max(m.kickoff_at) as last_ko
    from public.matches m
    where m.season = p_season and m.round is not null
    group by m.round
    having bool_and(m.home_score is not null)
    order by m.round desc
    limit 1
  ), me as (
    select e.id as entry_id from public.entries e where e.user_id = auth.uid() and e.season = p_season
  ), lg as (
    select p.id, p.name, p.join_code,
           (select count(*) from public.pool_members x where x.pool_id = p.id) as members
    from public.pools p
    join public.pool_members pm on pm.pool_id = p.id and pm.user_id = auth.uid()
    where p.season = p_season and p.school_emis is null
    order by (p.created_by = auth.uid()) desc, members desc, p.id
    limit 1
  ), scores as (
    select e.user_id, coalesce(t.total_pts, 0) as pts
    from lg
    join public.pool_members pm on pm.pool_id = lg.id
    join public.entries e on e.user_id = pm.user_id and e.season = p_season
    left join public.entry_round_totals t on t.entry_id = e.id and t.round = (select round from r)
  )
  select case when auth.uid() is null or not exists (select 1 from r) or not exists (select 1 from me)
                   or (select last_ko from r) < p_now - interval '5 days' then null
         else jsonb_build_object(
    'round', (select round from r),
    'pts', (select coalesce(t.total_pts, 0) from me left join public.entry_round_totals t on t.entry_id = me.entry_id and t.round = (select round from r)),
    'pool_id', (select id from lg),
    'pool_name', (select name from lg),
    'join_code', (select join_code from lg),
    'members', (select members from lg),
    'rank', (select 1 + count(*) from scores s where s.pts > (select pts from scores where user_id = auth.uid())),
    'of', (select count(*) from scores)) end
$$;
revoke all on function public.after_round(text, timestamptz) from public, anon;
grant execute on function public.after_round(text, timestamptz) to authenticated;

-- For the person who started a league: everyone in it and how many of the
-- next round's games they've called. Nobody else gets anything.
create or replace function public.organiser_round(p_pool bigint, p_now timestamptz default now())
returns table (round integer, first_ko timestamptz, games integer, user_id uuid, display_name text, called integer)
language sql stable
security definer
set search_path = ''
as $$
  with p as (
    select id, season from public.pools where id = p_pool and created_by = auth.uid() and school_emis is null
  ), r as (
    select m.round, min(m.kickoff_at) as first_ko, count(*)::integer as games
    from public.matches m join p on p.season = m.season
    where m.round is not null and m.kickoff_at > p_now
    group by m.round
    order by min(m.kickoff_at)
    limit 1
  )
  select r.round, r.first_ko, r.games, mb.user_id, mb.display_name,
         (select count(*)::integer from public.predictions pr
            join public.entries e on e.id = pr.entry_id and e.user_id = mb.user_id and e.season = p.season
            join public.matches m on m.id = pr.match_id and m.round = r.round)
  from p cross join r
  join public.pool_members pm on pm.pool_id = p.id
  join public.members mb on mb.user_id = pm.user_id
  order by mb.display_name
$$;
revoke all on function public.organiser_round(bigint, timestamptz) from public, anon;
grant execute on function public.organiser_round(bigint, timestamptz) to authenticated;

-- Monday's growth line for admins.
create or replace function notify.growth_line(p_now timestamptz default now())
returns text
language sql stable
set search_path = ''
as $$
  with wk as (
    select date_trunc('week', p_now at time zone 'Africa/Johannesburg') - interval '7 days' as from_local
  ), b as (
    select (from_local at time zone 'Africa/Johannesburg') as t0,
           ((from_local + interval '7 days') at time zone 'Africa/Johannesburg') as t1 from wk
  ), callers as (
    select distinct e.user_id from analytics.events e, b
    where e.name = 'call_made' and e.user_id is not null and e.at >= b.t0 and e.at < b.t1
  ), live as (
    select p.id from public.pools p
    where p.school_emis is null
      and (select count(*) from public.pool_members m join callers c on c.user_id = m.user_id where m.pool_id = p.id) >= 4
  )
  select 'Last week ' || (select count(*) from callers) || ' called (sprint target 100 a week by 29 Nov). '
         || (select count(*) from public.members m, b where m.joined_at >= b.t0 and m.joined_at < b.t1) || ' new player'
         || case when (select count(*) from public.members m, b where m.joined_at >= b.t0 and m.joined_at < b.t1) = 1 then '' else 's' end
         || ', ' || (select count(*) from live) || ' league' || case when (select count(*) from live) = 1 then '' else 's' end
         || ' with 4 or more calling, ' || (select count(*) from public.members) || ' players in all.'
$$;
revoke all on function notify.growth_line(timestamptz) from public, anon, authenticated;

create or replace function notify.send_growth_line()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  line text := notify.growth_line();
  key text;
  cfg jsonb := (select jsonb_object_agg(s.key, s.value) from notify.settings s);
  a record;
  n integer := 0;
  pushed integer := 0;
begin
  select decrypted_secret into key from vault.decrypted_secrets where name = 'brevo_api_key';
  for a in select m.user_id, m.email, m.display_name from public.members m where m.is_admin loop
    if exists (select 1 from public.push_subscriptions ps where ps.user_id = a.user_id) then
      insert into notify.push_outbox (user_id, title, body, url, tag)
      values (a.user_id, 'Scrumline this week', line, notify.app_link('admin/metrics/'), 'growth-line');
      pushed := pushed + 1;
    elsif key is not null and a.email is not null then
      perform net.http_post(
        url := 'https://api.brevo.com/v3/smtp/email',
        headers := jsonb_build_object('api-key', key, 'content-type', 'application/json', 'accept', 'application/json'),
        body := jsonb_build_object(
          'sender', jsonb_build_object('email', cfg ->> 'sender_email', 'name', cfg ->> 'sender_name'),
          'to', jsonb_build_array(jsonb_build_object('email', a.email, 'name', a.display_name)),
          'subject', 'Scrumline this week',
          'htmlContent', '<p>' || line || '</p><p><a href="' || notify.app_link('admin/metrics/') || '">See the numbers</a></p>'));
    else
      continue;
    end if;
    n := n + 1;
  end loop;
  if pushed > 0 then perform notify.kick_push(); end if;
  return n;
end $$;
revoke all on function notify.send_growth_line() from public, anon, authenticated;

-- Mondays 05:00 UTC, 07:00 in South Africa.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('growth-line', '0 5 * * 1', 'select notify.send_growth_line()');
  end if;
end $$;

insert into analytics.event_names (name, source, description) values
  ('mate_card_shown',  'app', 'Home showed the bring-a-mate card after a round''s results (props: round)'),
  ('organiser_nudged', 'app', 'A league organiser opened WhatsApp to nudge players who hadn''t called (props: round, missing)')
on conflict (name) do nothing;
