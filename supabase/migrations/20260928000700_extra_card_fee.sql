-- The card fee on an extra donation comes out of the extra, not out of
-- Scrumline's share, so a big gift can never cost us more than the slot
-- earns. It is a flat, published 3.5% (rounded up to the cent), worked out
-- when the extra is set and shown at checkout; the rest reaches the schools.
-- The card fee on the slot price itself stays ours.

alter table public.sponsor_bookings
  add column extra_fee_minor bigint not null default 0 check (extra_fee_minor between 0 and extra_minor);

create or replace function public.extra_card_fee(p_extra_minor bigint)
returns bigint
language sql immutable
as $$ select (p_extra_minor * 35 + 999) / 1000 $$;

create or replace function public.set_booking_donation(p_booking bigint, p_extra_minor bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.sponsor_bookings;
begin
  select * into b from public.sponsor_bookings where id = p_booking for update;
  if b.id is null or not public.manages_sponsor(b.sponsor_id) then raise exception 'Not your booking' using errcode = '42501'; end if;
  if b.status <> 'held' or b.held_until <= now() then raise exception 'This hold has expired. Pick the slot again.' using errcode = 'P0001'; end if;
  if p_extra_minor is null or p_extra_minor < 0 or p_extra_minor > 10000000 then
    raise exception 'An extra donation can be up to R100,000' using errcode = '22023';
  end if;
  update public.sponsor_bookings set extra_minor = p_extra_minor, extra_fee_minor = public.extra_card_fee(p_extra_minor) where id = b.id;
end $$;
revoke execute on function public.set_booking_donation(bigint, bigint) from public, anon;
grant execute on function public.set_booking_donation(bigint, bigint) to authenticated;

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
  if b.price_minor + b.extra_minor <> p_amount_minor or b.currency <> p_currency then return 'amount mismatch'; end if;
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
    from alloc a cross join (values ('own', b.own_school_minor + b.extra_minor - b.extra_fee_minor), ('partner', b.partner_school_minor)) sh(share, minor)
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
         b.own_school_minor + b.partner_school_minor + b.extra_minor - b.extra_fee_minor, b.currency
  from public.sponsor_bookings b
  join public.sponsors s on s.id = b.sponsor_id and not s.blocked
  join public.pools p on p.id = b.pool_id
  cross join wk
  where b.status = 'live'
    and not exists (select 1 from notify.sponsor_reports_sent r where r.booking_id = b.id and r.week = date_trunc('week', wk.today)::date)
$$;
