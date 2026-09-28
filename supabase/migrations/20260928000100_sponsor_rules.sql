-- Sponsor rules that run themselves: no admin step stands between a business
-- and going live, and a sponsor's place is protected once it has one.
--
-- 1. A slot is worth buying: at least 5 players in the pool, and a school's
--    pools open once 5 of its players are confirmed by schoolmates. A school
--    that asks not to be sponsored is switched off with one flag.
-- 2. Renewal right: last season's sponsor of a school or class slot has it
--    to themselves until 14 days before the new tournament's first kickoff.
-- 3. One business per category per school per tournament: a motoring
--    sponsor is the only motoring name on that school's pools.
-- 4. Names and offer lines are approved automatically unless they trip the
--    word check (betting, adult, drugs, swearing); only those wait for a person.
-- 5. Every live sponsor gets a short results email each Monday.

alter table public.schools add column sponsor_optout boolean not null default false;

-- Last season's sponsor of this slot, while their renewal window is open.
create or replace function public.renewal_holder(p_pool bigint)
returns table (sponsor_id bigint, sponsor_name text, until timestamptz)
language sql stable
security definer
set search_path = public
as $$
  with p as (
    select pl.*, se.competition_id, se.starts_on,
           (select min(m.kickoff_at) from public.matches m where m.season = pl.season) as first_kickoff
    from public.pools pl join public.seasons se on se.id = pl.season
    where pl.id = p_pool and pl.school_emis is not null
  ), prev as (
    select se.id from public.seasons se, p
    where se.competition_id = p.competition_id and se.id <> p.season and se.starts_on < p.starts_on
    order by se.starts_on desc limit 1
  )
  select b.sponsor_id, s.name, p.first_kickoff - interval '14 days'
  from p
  join public.pools old on old.season = (select id from prev) and old.school_emis = p.school_emis
                       and old.school_stage is not distinct from p.school_stage
                       and old.school_year is not distinct from p.school_year
  join public.sponsor_bookings b on b.pool_id = old.id and b.round is null and b.status in ('paid', 'live', 'ended')
  join public.sponsors s on s.id = b.sponsor_id and not s.blocked
  where now() < p.first_kickoff - interval '14 days'
  order by b.paid_at desc
  limit 1
$$;

-- Why a slot can't be bought right now, or null if it can. With a sponsor,
-- also checks that sponsor's category against the school's other sponsors.
create or replace function public.slot_block(p_pool bigint, p_round int, p_sponsor bigint default null)
returns text
language plpgsql stable
security definer
set search_path = public
as $$
declare
  p public.pools;
  players int;
  confirmed int;
  h record;
  cat text;
  clash text;
begin
  select * into p from public.pools where id = p_pool;
  if p.id is null then return 'Nothing to sponsor here'; end if;
  select count(*) into players from public.pool_members where pool_id = p_pool;
  if players < 5 then return 'Opens once 5 players have joined'; end if;
  if p.school_emis is not null then
    if (select sponsor_optout from public.schools where emis = p.school_emis) then
      return 'This school isn''t taking sponsors';
    end if;
    select count(*) into confirmed from public.school_members sm
    where sm.emis = p.school_emis and sm.stage = p.school_stage and sm.verified;
    if confirmed < 5 then return 'Opens once 5 players from the school are confirmed'; end if;
  end if;
  if p_round is null then
    select * into h from public.renewal_holder(p_pool);
    if h.sponsor_id is not null and not public.manages_sponsor(h.sponsor_id)
       and (p_sponsor is null or p_sponsor <> h.sponsor_id) then
      return 'Held for ' || h.sponsor_name || ' to renew until ' || to_char(h.until at time zone 'Africa/Johannesburg', 'FMDD FMMonth');
    end if;
  end if;
  if p_sponsor is not null and p.school_emis is not null then
    select category into cat from public.sponsors where id = p_sponsor;
    if cat <> 'other' then
      select s.name into clash
      from public.sponsor_bookings b
      join public.pools o on o.id = b.pool_id
      join public.sponsors s on s.id = b.sponsor_id
      where o.season = p.season and o.school_emis = p.school_emis and o.school_stage is not distinct from p.school_stage
        and b.sponsor_id <> p_sponsor and s.category = cat
        and (b.status in ('paid', 'live') or (b.status = 'held' and b.held_until > now()))
      limit 1;
      if clash is not null then
        return clash || ' already sponsors this school in the same line of business';
      end if;
    end if;
  end if;
  return null;
end $$;

-- The quote now says why a slot isn't available.
drop function public.sponsor_slots(text, text, text);
drop function public.sponsor_quote(bigint, int, text);
create function public.sponsor_quote(p_pool bigint, p_round int default null, p_country text default 'ZA')
returns table (pool_id bigint, pool_name text, kind text, players int, price_minor bigint, currency text,
               available boolean, taken_by text, reason text)
language sql stable
security definer
set search_path = public
as $$
  with p as (
    select pl.id, pl.name, public.pool_kind(pl.id) as kind,
           (select count(*)::int from public.pool_members pm where pm.pool_id = pl.id) as players
    from public.pools pl where pl.id = p_pool
  ), taken as (
    select s.name from public.sponsor_bookings b join public.sponsors s on s.id = b.sponsor_id
    where b.pool_id = p_pool and b.round is not distinct from p_round and b.status in ('held', 'paid', 'live')
      and (b.status <> 'held' or b.held_until > now())
    limit 1
  ), why as (
    select public.slot_block(p_pool, p_round) as r
  )
  select p.id, p.name, p.kind, p.players,
         (select case when p_round is null then pr.season_minor else pr.round_minor end
          from public.sponsor_prices pr
          where pr.country = p_country and pr.kind = p.kind and pr.min_players <= p.players
          order by pr.min_players desc limit 1),
         (select currency from public.countries where code = p_country),
         not exists (select 1 from taken) and (select r from why) is null,
         (select name from taken),
         case when exists (select 1 from taken) then null else (select r from why) end
  from p
$$;

create function public.sponsor_slots(p_emis text, p_season text, p_country text default 'ZA')
returns table (pool_id bigint, pool_name text, kind text, school_year int, players int, price_minor bigint,
               currency text, available boolean, taken_by text, reason text,
               next_round int, round_price_minor bigint, round_available boolean)
language sql stable
security definer
set search_path = public
as $$
  with nr as (
    select min(m.round) as r from public.matches m
    where m.season = p_season
      and not exists (select 1 from public.matches o where o.season = p_season and o.round = m.round and o.kickoff_at <= now())
  )
  select p.id, p.name, q.kind, p.school_year, q.players, q.price_minor, q.currency, q.available, q.taken_by, q.reason,
         nr.r, rq.price_minor, rq.available
  from public.pools p
  cross join nr
  cross join lateral public.sponsor_quote(p.id, null, p_country) q
  left join lateral public.sponsor_quote(p.id, nr.r, p_country) rq on nr.r is not null
  where p.school_emis = p_emis and p.season = p_season and auth.uid() is not null
  order by p.school_year is not null, p.school_year desc
$$;

-- Holding a slot applies every rule, including the sponsor's category.
create or replace function public.hold_sponsor_slot(p_sponsor bigint, p_pool bigint, p_round int default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.sponsors;
  q record;
  why text;
  own bigint; twin bigint; prize bigint;
  new_id bigint;
begin
  select * into s from public.sponsors where id = p_sponsor;
  if s.id is null or s.blocked or not public.manages_sponsor(p_sponsor) then
    raise exception 'Not your sponsor account' using errcode = '42501';
  end if;
  if not (select open_to_sponsors from public.countries where code = s.country) then
    raise exception 'Sponsorship isn''t open in this country yet' using errcode = 'P0001';
  end if;
  update public.sponsor_bookings set status = 'lapsed'
  where pool_id = p_pool and round is not distinct from p_round and status = 'held' and held_until <= now();
  why := public.slot_block(p_pool, p_round, p_sponsor);
  if why is not null then raise exception '%', why using errcode = 'P0001'; end if;
  select * into q from public.sponsor_quote(p_pool, p_round, s.country);
  if q.pool_id is null or q.price_minor is null then raise exception 'Nothing to sponsor here' using errcode = 'P0001'; end if;
  if q.taken_by is not null then raise exception 'Already sponsored by %', q.taken_by using errcode = 'P0001'; end if;
  own := q.price_minor * 20 / 100; twin := own; prize := own;
  insert into public.sponsor_bookings (sponsor_id, pool_id, round, kind, players_at_sale, currency, price_minor,
                                       own_school_minor, twin_school_minor, prize_minor, scrumline_minor)
  values (p_sponsor, p_pool, p_round, q.kind, q.players, q.currency, q.price_minor,
          own, twin, prize, q.price_minor - own - twin - prize)
  returning id into new_id;
  return new_id;
end $$;

-- Words that send a name or line to a person instead of straight on air.
create or replace function public.sponsor_text_ok(p_text text)
returns boolean
language sql immutable
set search_path = public
as $$
  select coalesce(p_text, '') !~* ('\m(bets?|betting|bookmakers?|casinos?|gambl\w*|lotto\w*|lotter\w*|poker|wager\w*|jackpots?|'
    || 'betway|hollywoodbets|supabets|playabets|sportingbet|gbets|sunbet|'
    || 'porn\w*|escorts?|xxx|sex\w*|strip\s*club|cannabis|dagga|weed|vapes?|vaping|'
    || 'f+u+c+k\w*|shit\w*|cunt\w*|poes|kak|naai\w*)\M')
$$;

-- A clean name and line are approved on the spot; a paid booking goes live
-- straight away. Anything the word check catches waits for a person.
drop function public.save_sponsor_creative(bigint, text, text, text, text, text);
create function public.save_sponsor_creative(p_booking bigint, p_name text, p_offer text, p_link text, p_prize text, p_logo text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.sponsor_bookings;
  ok boolean := public.sponsor_text_ok(p_name) and public.sponsor_text_ok(p_offer) and public.sponsor_text_ok(p_prize)
                and public.sponsor_text_ok(p_link);
begin
  select * into b from public.sponsor_bookings where id = p_booking;
  if b.id is null or not public.manages_sponsor(b.sponsor_id) then raise exception 'Not your booking' using errcode = '42501'; end if;
  insert into public.sponsor_creatives (booking_id, display_name, offer, link, prize_text, logo_path, status, reviewed_at)
  values (p_booking, btrim(p_name), nullif(btrim(p_offer), ''), nullif(btrim(p_link), ''), nullif(btrim(p_prize), ''), p_logo,
          case when ok then 'approved' else 'pending' end, case when ok then now() end)
  on conflict (booking_id) do update
    set display_name = excluded.display_name, offer = excluded.offer, link = excluded.link,
        prize_text = excluded.prize_text, logo_path = coalesce(excluded.logo_path, public.sponsor_creatives.logo_path),
        status = excluded.status, reviewed_by = null, reviewed_at = excluded.reviewed_at;
  update public.sponsor_bookings set status = case when ok then 'live' else 'paid' end
  where id = p_booking and status in ('paid', 'live');
  return case when ok then 'approved' else 'pending' end;
end $$;

-- A blocked sponsor disappears everywhere at once.
create or replace function public.pool_sponsors(p_pool bigint)
returns table (booking_id bigint, round int, display_name text, logo_path text, offer text, link text, prize_text text)
language sql stable
security definer
set search_path = public
as $$
  select b.id, b.round, c.display_name, c.logo_path, c.offer, c.link, c.prize_text
  from public.sponsor_bookings b
  join public.sponsors s on s.id = b.sponsor_id and not s.blocked
  join public.sponsor_creatives c on c.booking_id = b.id and c.status = 'approved'
  where b.pool_id = p_pool and b.status = 'live' and public.is_pool_member(p_pool)
$$;

-- 5. Monday results email to every live sponsor ---------------------------------
create table notify.sponsor_reports_sent (
  booking_id bigint not null references public.sponsor_bookings(id) on delete cascade,
  week       date   not null,
  request_id bigint,
  primary key (booking_id, week)
);

-- What each live sponsor gets this week: the last 7 days and the season so far.
create or replace function notify.due_sponsor_reports(p_now timestamptz default now())
returns table (booking_id bigint, email text, sponsor text, pool text, week date,
               seen_week int, players_week int, shares_week int, taps_week int, seen_total int, schools_minor bigint, currency text)
language sql stable
security definer
set search_path = public, notify
as $$
  with wk as (select (p_now at time zone 'Africa/Johannesburg')::date as today)
  select b.id, s.email, s.name, p.name, date_trunc('week', wk.today)::date,
         coalesce((select sum(d.seen) from public.sponsor_daily d where d.booking_id = b.id and d.day > wk.today - 7), 0)::int,
         (select count(distinct x.user_id) from public.sponsor_sightings x where x.booking_id = b.id and x.day > wk.today - 7)::int,
         coalesce((select sum(d.shares) from public.sponsor_daily d where d.booking_id = b.id and d.day > wk.today - 7), 0)::int,
         coalesce((select sum(d.taps) from public.sponsor_daily d where d.booking_id = b.id and d.day > wk.today - 7), 0)::int,
         coalesce((select sum(d.seen) from public.sponsor_daily d where d.booking_id = b.id), 0)::int,
         b.own_school_minor + b.twin_school_minor, b.currency
  from public.sponsor_bookings b
  join public.sponsors s on s.id = b.sponsor_id and not s.blocked
  join public.pools p on p.id = b.pool_id
  cross join wk
  where b.status = 'live'
    and not exists (select 1 from notify.sponsor_reports_sent r where r.booking_id = b.id and r.week = date_trunc('week', wk.today)::date)
$$;

create or replace function notify.send_sponsor_reports()
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
  cfg jsonb := (select jsonb_object_agg(s.key, s.value) from notify.settings s);
  base text := regexp_replace(coalesce(cfg ->> 'app_url', ''), 'predict/?$', '');
  esc text;
begin
  select decrypted_secret into key from vault.decrypted_secrets where name = 'brevo_api_key';
  if key is null then return 0; end if;
  for d in select * from notify.due_sponsor_reports() loop
    esc := replace(replace(replace(d.pool, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
    rid := net.http_post(
      url := 'https://api.brevo.com/v3/smtp/email',
      headers := jsonb_build_object('api-key', key, 'content-type', 'application/json', 'accept', 'application/json'),
      body := jsonb_build_object(
        'sender', jsonb_build_object('email', cfg ->> 'sender_email', 'name', cfg ->> 'sender_name'),
        'to', jsonb_build_array(jsonb_build_object('email', d.email, 'name', d.sponsor)),
        'subject', 'Your week on Scrumline: seen ' || d.seen_week || ' times',
        'htmlContent',
          '<p>Here''s how ' || replace(replace(d.sponsor, '&', '&amp;'), '<', '&lt;') || ' did in ' || esc || ' this week.</p>'
          || '<ul><li><b>' || d.seen_week || '</b> times seen, by <b>' || d.players_week || '</b> players</li>'
          || '<li><b>' || d.shares_week || '</b> round cards shared with your name on them</li>'
          || '<li><b>' || d.taps_week || '</b> taps through to your site</li></ul>'
          || '<p>Season so far: seen ' || d.seen_total || ' times. Your sponsorship is sending '
          || case d.currency when 'ZAR' then 'R' else d.currency || ' ' end || to_char(d.schools_minor / 100, 'FM999G999G990')
          || ' to schools.</p>'
          || '<p><a href="' || base || 'sponsor/results/?b=' || d.booking_id || '">See your full results</a></p>'
      )
    );
    insert into notify.sponsor_reports_sent (booking_id, week, request_id) values (d.booking_id, d.week, rid)
    on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on all functions in schema notify from public, anon, authenticated;
revoke all on notify.sponsor_reports_sent from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('sponsor-weekly-report', '0 6 * * 1', 'select notify.send_sponsor_reports()');  -- Mondays 08:00 SAST
  end if;
end $$;

-- Access -------------------------------------------------------------------------
revoke execute on function public.renewal_holder(bigint), public.slot_block(bigint, int, bigint),
  public.sponsor_quote(bigint, int, text), public.sponsor_slots(text, text, text),
  public.save_sponsor_creative(bigint, text, text, text, text, text), public.sponsor_text_ok(text)
  from public, anon;
grant execute on function public.sponsor_quote(bigint, int, text), public.sponsor_slots(text, text, text),
  public.save_sponsor_creative(bigint, text, text, text, text, text) to authenticated;
revoke execute on function public.renewal_holder(bigint), public.slot_block(bigint, int, bigint) from authenticated;
