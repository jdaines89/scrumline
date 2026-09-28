-- Partner schools, matched automatically.
--
-- "Twin" claimed two schools were equals, which they aren't, so the second
-- 20% now goes to a partner school: the nearest no-fee school at the same
-- level (matric, else primary), chosen by Scrumline, not claimed by either
-- school. No no-fee school partners more than 3 schools, so the money
-- spreads. A no-fee school that is sponsored itself keeps both shares.
--
-- Matching runs by itself: match_partner_schools() pairs any fee-paying
-- school without a partner, a batch at a time, on a 10-minute cron. Once
-- every school is paired it finds nothing to do; new schools are paired the
-- next time it runs.

-- 1. Names -------------------------------------------------------------------
alter table public.school_twins rename to school_partners;
alter table public.school_partners rename column twin_emis to partner_emis;
alter table public.school_partners
  add column distance_km numeric(6,1),
  add column matched_at  timestamptz not null default now();
create index school_partners_partner on public.school_partners (partner_emis);

alter table public.sponsor_bookings rename column twin_school_minor to partner_school_minor;
alter table public.school_allocations drop constraint school_allocations_share_check;
update public.school_allocations set share = 'partner' where share = 'twin';
alter table public.school_allocations add constraint school_allocations_share_check check (share in ('own', 'partner'));

-- 2. Matching ----------------------------------------------------------------
-- Straight-line km from coordinates (good enough to find the nearest school).
create or replace function public.km(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision
language sql immutable
as $$
  select 111.2 * sqrt(power(lat2 - lat1, 2) + power((lon2 - lon1) * cos(radians((lat1 + lat2) / 2)), 2))
$$;

create or replace function public.match_partner_schools(p_limit int default 500)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  f record;
  pick record;
  n int := 0;
begin
  for f in
    select s.* from public.schools s
    where not s.no_fee and (s.offers_matric or s.offers_primary)
      and not exists (select 1 from public.school_partners p where p.emis = s.emis)
    order by s.lat is null, s.emis  -- schools we can place on a map go first, so they get the truly nearest
    limit p_limit
  loop
    -- The nearest no-fee school at the same level in the same province with
    -- room left; without coordinates, the same district, then the same town.
    select c.emis, case when f.lat is not null and c.lat is not null then public.km(f.lat, f.lon, c.lat, c.lon) end as d
    into pick
    from public.schools c
    where c.no_fee and c.province = f.province and c.emis <> f.emis
      and case when f.offers_matric then c.offers_matric else c.offers_primary end
      and (select count(*) from public.school_partners p where p.partner_emis = c.emis) < 3
    order by case when f.lat is not null and c.lat is not null then public.km(f.lat, f.lon, c.lat, c.lon) end nulls last,
             (c.district is not distinct from f.district) desc, (c.town is not distinct from f.town) desc, c.emis
    limit 1;
    if pick.emis is not null then
      insert into public.school_partners (emis, partner_emis, distance_km) values (f.emis, pick.emis, round(pick.d::numeric, 1));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.match_partner_schools(int) from public, anon, authenticated;

-- 3. Money follows the new names ---------------------------------------------
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
  own bigint; partner bigint; prize bigint;
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
  own := q.price_minor * 20 / 100; partner := own; prize := own;
  insert into public.sponsor_bookings (sponsor_id, pool_id, round, kind, players_at_sale, currency, price_minor,
                                       own_school_minor, partner_school_minor, prize_minor, scrumline_minor)
  values (p_sponsor, p_pool, p_round, q.kind, q.players, q.currency, q.price_minor,
          own, partner, prize, q.price_minor - own - partner - prize)
  returning id into new_id;
  return new_id;
end $$;

create or replace function public.sponsor_booking_paid(p_booking bigint, p_provider text, p_ref text, p_amount_minor bigint, p_currency text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.sponsor_bookings;
begin
  select * into b from public.sponsor_bookings where id = p_booking for update;
  if b.id is null then return 'no such booking'; end if;
  if b.status in ('paid', 'live') and b.provider_ref = p_ref then return 'already paid'; end if;
  if b.price_minor <> p_amount_minor or b.currency <> p_currency then return 'amount mismatch'; end if;
  if b.status not in ('held', 'lapsed') then return 'booking is ' || b.status; end if;
  if b.status = 'lapsed' and exists (select 1 from public.sponsor_bookings o
       where o.pool_id = b.pool_id and o.round is not distinct from b.round and o.id <> b.id and o.status in ('held', 'paid', 'live')) then
    update public.sponsor_bookings set status = 'refund_due', provider = p_provider, provider_ref = p_ref, paid_at = now()
    where id = b.id;
    return 'slot taken while payment was pending';
  end if;

  update public.sponsor_bookings
  set status = case when exists (select 1 from public.sponsor_creatives c where c.booking_id = b.id and c.status = 'approved')
                    then 'live' else 'paid' end,
      provider = p_provider, provider_ref = p_ref, paid_at = now()
  where id = b.id;

  -- Each player counts for their high school (else primary), as the pool
  -- stands now; a school or class pool counts wholly for its own school. A
  -- pool with no players yet gives everything to its school, or the fund.
  -- Pro rata, rounded down; the leftover cents go to the biggest school, so
  -- each side adds up to its share exactly. The partner side mirrors the own
  -- side school by school: a no-fee school keeps its partner share, and a
  -- school without a partner yet gives it to the fund.
  insert into public.school_allocations (booking_id, emis, share, amount_minor, currency)
  with counted as (
    select coalesce(pl.school_emis,
                    (select emis from public.member_schools ms where ms.user_id = pm.user_id and ms.stage = 'high'),
                    (select emis from public.member_schools ms where ms.user_id = pm.user_id and ms.stage = 'primary')) as emis,
           count(*) as n
    from public.pool_members pm join public.pools pl on pl.id = pm.pool_id
    where pm.pool_id = b.pool_id
    group by 1
  ), alloc as (
    select emis, n from counted
    union all
    select school_emis, 1 from public.pools where id = b.pool_id and not exists (select 1 from counted)
  ), split as (
    select a.emis, a.n, sh.share, sh.minor, sum(a.n) over (partition by sh.share)::bigint as total,
           row_number() over (partition by sh.share order by a.n desc, a.emis nulls last) as rn
    from alloc a cross join (values ('own', b.own_school_minor), ('partner', b.partner_school_minor)) sh(share, minor)
  ), amounts as (
    select emis, share, rn, minor, minor * n / total as base from split
  )
  select b.id,
         case when x.share = 'own' then x.emis
              when (select no_fee from public.schools where emis = x.emis) then x.emis
              else t.partner_emis end,
         x.share,
         sum(x.base + case when x.rn = 1 then x.minor - (select sum(y.base) from amounts y where y.share = x.share) else 0 end),
         b.currency
  from amounts x left join public.school_partners t on t.emis = x.emis
  group by 2, 3;
  return 'ok';
end $$;

drop function public.sponsor_results(bigint);
create function public.sponsor_results(p_booking bigint)
returns table (players int, reached int, seen int, shares int, taps int,
               own_paid bigint, partner_paid bigint, own_due bigint, partner_due bigint)
language sql stable
security definer
set search_path = public
as $$
  select b.players_at_sale,
         (select count(distinct user_id)::int from public.sponsor_sightings where booking_id = b.id),
         coalesce((select sum(d.seen)::int from public.sponsor_daily d where d.booking_id = b.id), 0),
         coalesce((select sum(d.shares)::int from public.sponsor_daily d where d.booking_id = b.id), 0),
         coalesce((select sum(d.taps)::int from public.sponsor_daily d where d.booking_id = b.id), 0),
         coalesce((select sum(amount_minor) from public.school_allocations a where a.booking_id = b.id and a.share = 'own' and a.status <> 'due'), 0),
         coalesce((select sum(amount_minor) from public.school_allocations a where a.booking_id = b.id and a.share = 'partner' and a.status <> 'due'), 0),
         coalesce((select sum(amount_minor) from public.school_allocations a where a.booking_id = b.id and a.share = 'own'), 0),
         coalesce((select sum(amount_minor) from public.school_allocations a where a.booking_id = b.id and a.share = 'partner'), 0)
  from public.sponsor_bookings b
  where b.id = p_booking and public.manages_sponsor(b.sponsor_id)
$$;
revoke execute on function public.sponsor_results(bigint) from public, anon;
grant execute on function public.sponsor_results(bigint) to authenticated;

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
         b.own_school_minor + b.partner_school_minor, b.currency
  from public.sponsor_bookings b
  join public.sponsors s on s.id = b.sponsor_id and not s.blocked
  join public.pools p on p.id = b.pool_id
  cross join wk
  where b.status = 'live'
    and not exists (select 1 from notify.sponsor_reports_sent r where r.booking_id = b.id and r.week = date_trunc('week', wk.today)::date)
$$;
revoke all on function notify.due_sponsor_reports(timestamptz) from public, anon, authenticated;

-- What a sponsor sees before paying: the school's partner, in plain words.
create or replace function public.school_partner(p_emis text)
returns table (emis text, name text, town text, distance_km numeric)
language sql stable
security definer
set search_path = public
as $$
  select c.emis, c.name, c.town, p.distance_km
  from public.school_partners p join public.schools c on c.emis = p.partner_emis
  where p.emis = p_emis and auth.uid() is not null
$$;
revoke execute on function public.school_partner(text) from public, anon;
grant execute on function public.school_partner(text) to authenticated;

-- 4. Run it --------------------------------------------------------------------
select public.match_partner_schools(500);
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('partner-schools', '*/10 * * * *', 'select public.match_partner_schools(500)');
  end if;
end $$;
