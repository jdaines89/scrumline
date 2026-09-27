-- Sponsor platform, part 1: the data.
-- Design: plans/sponsor-platform-design.md (project files).
--
-- A business sponsors a pool: a whole school's pool, a class year's pool, a
-- pool of mates, or one round of any of them. Everything a sponsor can buy
-- is a pool, because a pool is already the group that plays, chats, shares
-- recaps and wins prizes together.
--
-- Country is data, not code. Currency, prices, payment provider, the tax
-- receipt for donations and the school registry all come from the countries
-- row, so a new country is new rows (its schools and a price list), not new
-- code.
--
-- Money is kept in minor units (cents, paise) as bigint, never floats. The
-- split is fixed at the moment of sale and stored on the booking, so a later
-- change to the rules never rewrites what a sponsor was told: 20% the
-- players' own schools, 20% their no-fee twins, 20% prizes, 40% Scrumline
-- (which takes any rounding remainder).

-- 1. Countries -------------------------------------------------------------
create table public.countries (
  code             text primary key check (code ~ '^[A-Z]{2}$'),
  name             text not null,
  currency         text not null check (currency ~ '^[A-Z]{3}$'),
  currency_symbol  text not null,
  payment_provider text not null check (payment_provider in ('paystack', 'razorpay')),
  donation_receipt text not null,          -- e.g. 'Section 18A', 'Section 80G'
  tax_name         text not null,          -- e.g. 'VAT', 'GST'
  tax_rate         numeric(5,4) not null check (tax_rate between 0 and 1),
  school_registry  text not null,          -- e.g. 'DBE EMIS', 'UDISE+'
  open_to_sponsors boolean not null default false
);
insert into public.countries values
  ('ZA', 'South Africa', 'ZAR', 'R', 'paystack', 'Section 18A', 'VAT', 0.15, 'DBE EMIS', true),
  ('IN', 'India', 'INR', '₹', 'razorpay', 'Section 80G', 'GST', 0.18, 'UDISE+', false);

alter table public.schools add column country text not null default 'ZA' references public.countries(code);

-- Each school's no-fee twin, which receives the second 20%. Filled by a
-- separate matching job (nearest no-fee school); without one, that share
-- goes to the Foundation's no-fee fund.
create table public.school_twins (
  emis      text primary key references public.schools(emis),
  twin_emis text not null references public.schools(emis),
  check (twin_emis <> emis)
);

-- 2. Prices -----------------------------------------------------------------
-- A price per country, per kind of pool, by audience: the row with the
-- largest min_players at or below the pool's size applies.
create table public.sponsor_prices (
  country      text not null references public.countries(code),
  kind         text not null check (kind in ('school', 'class', 'pool')),
  min_players  int  not null check (min_players >= 0),
  season_minor bigint not null check (season_minor > 0),
  round_minor  bigint not null check (round_minor > 0),
  primary key (country, kind, min_players)
);
insert into public.sponsor_prices values
  ('ZA', 'school', 0,    250000, 75000), ('ZA', 'school', 100,  450000, 75000),
  ('ZA', 'school', 300,  650000, 75000), ('ZA', 'school', 1000, 1200000, 100000),
  ('ZA', 'class',  0,    150000, 75000), ('ZA', 'class',  25,   250000, 75000),
  ('ZA', 'class',  40,   350000, 75000),
  ('ZA', 'pool',   0,    150000, 75000), ('ZA', 'pool',   25,   250000, 75000),
  ('IN', 'school', 0,    800000, 250000), ('IN', 'class', 0,    500000, 250000),
  ('IN', 'pool',   0,    500000, 250000);

-- 3. Sponsors ---------------------------------------------------------------
create table public.sponsors (
  id         bigint generated always as identity primary key,
  country    text not null references public.countries(code),
  name       text not null check (length(btrim(name)) between 2 and 40),
  category   text not null check (category in
               ('motoring', 'food_drink', 'health', 'retail', 'services', 'property', 'finance',
                'telecoms', 'education', 'sport', 'other')),  -- no betting or gambling, ever
  email      text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  blocked    boolean not null default false
);

-- The people who can see and manage a sponsor's bookings and results.
create table public.sponsor_managers (
  sponsor_id bigint not null references public.sponsors(id) on delete cascade,
  user_id    uuid   not null references auth.users(id) on delete cascade,
  primary key (sponsor_id, user_id)
);

create or replace function public.manages_sponsor(p_sponsor bigint)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.sponsor_managers where sponsor_id = p_sponsor and user_id = auth.uid())
      or coalesce((select is_admin from public.members where user_id = auth.uid()), false)
$$;

-- 4. What a pool is, for sponsorship ---------------------------------------
create or replace function public.pool_kind(p_pool bigint)
returns text
language sql stable
security definer
set search_path = public
as $$
  select case when p.school_emis is null then 'pool'
              when p.school_year is null then 'school'
              else 'class' end
  from public.pools p where p.id = p_pool
$$;

-- 5. Bookings ----------------------------------------------------------------
create table public.sponsor_bookings (
  id               bigint generated always as identity primary key,
  sponsor_id       bigint not null references public.sponsors(id),
  pool_id          bigint not null references public.pools(id),
  round            int check (round > 0),             -- null: the whole season
  kind             text not null check (kind in ('school', 'class', 'pool')),
  players_at_sale  int not null,
  currency         text not null check (currency ~ '^[A-Z]{3}$'),
  price_minor      bigint not null check (price_minor > 0),
  own_school_minor bigint not null,
  twin_school_minor bigint not null,
  prize_minor      bigint not null,
  scrumline_minor  bigint not null,
  status           text not null default 'held' check (status in ('held', 'paid', 'live', 'ended', 'refunded', 'lapsed')),
  held_until       timestamptz not null default now() + interval '30 minutes',
  provider         text,
  provider_ref     text unique,
  paid_at          timestamptz,
  created_at       timestamptz not null default now(),
  check (own_school_minor + twin_school_minor + prize_minor + scrumline_minor = price_minor)
);
-- One sponsor per pool per season, and per pool per round.
create unique index sponsor_bookings_one_per_slot on public.sponsor_bookings (pool_id, coalesce(round, 0))
  where status in ('held', 'paid', 'live');

-- The quote a sponsor sees: players, price, and whether it's free.
create or replace function public.sponsor_quote(p_pool bigint, p_round int default null, p_country text default 'ZA')
returns table (pool_id bigint, pool_name text, kind text, players int, price_minor bigint, currency text,
               available boolean, taken_by text)
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
  )
  select p.id, p.name, p.kind, p.players,
         (select case when p_round is null then pr.season_minor else pr.round_minor end
          from public.sponsor_prices pr
          where pr.country = p_country and pr.kind = p.kind and pr.min_players <= p.players
          order by pr.min_players desc limit 1),
         (select currency from public.countries where code = p_country),
         not exists (select 1 from taken),
         (select name from taken)
  from p
$$;

-- 6. What players see ---------------------------------------------------------
create table public.sponsor_creatives (
  booking_id   bigint primary key references public.sponsor_bookings(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 2 and 40),
  logo_path    text,
  offer        text check (length(offer) <= 80),
  link         text check (link ~* '^https://[^\s]+$' and length(link) <= 200),
  prize_text   text check (length(prize_text) <= 80),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by  uuid references auth.users(id),
  reviewed_at  timestamptz
);

-- 7. The schools' 40% -------------------------------------------------------
-- Spread over the players' own schools as the pool stood at the moment of
-- payment: a school or class pool is one school; a pool of mates is split by
-- how many of its players went where. A share with no school (players who
-- haven't saved one, or a school without a twin yet) goes to the
-- Foundation's fund for no-fee schools, emis null.
create table public.school_allocations (
  id           bigint generated always as identity primary key,
  booking_id   bigint not null references public.sponsor_bookings(id) on delete cascade,
  emis         text references public.schools(emis),
  share        text not null check (share in ('own', 'twin')),
  amount_minor bigint not null check (amount_minor >= 0),
  currency     text not null,
  status       text not null default 'due' check (status in ('due', 'paid', 'confirmed')),
  reference    text,
  paid_at      timestamptz,
  confirmed_at timestamptz
);
create index school_allocations_school on public.school_allocations (emis, status);

-- 8. Results ------------------------------------------------------------------
-- One row per player per booking per day they saw the sponsor, so "seen" is
-- counted once a day per person and distinct players come from the same
-- table. Shares and taps are plain counters per day.
create table public.sponsor_sightings (
  booking_id bigint not null references public.sponsor_bookings(id) on delete cascade,
  user_id    uuid   not null references public.members(user_id) on delete cascade,
  day        date   not null default (now() at time zone 'Africa/Johannesburg')::date,
  primary key (booking_id, day, user_id)
);
create table public.sponsor_daily (
  booking_id bigint not null references public.sponsor_bookings(id) on delete cascade,
  day        date   not null,
  seen       int not null default 0,
  shares     int not null default 0,
  taps       int not null default 0,
  primary key (booking_id, day)
);

-- 9. Functions ------------------------------------------------------------------

-- Hold a slot while the sponsor pays (30 minutes). Works out the price and
-- the split now, so the checkout shows exactly what will be charged.
create or replace function public.hold_sponsor_slot(p_sponsor bigint, p_pool bigint, p_round int default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.sponsors;
  q record;
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
  -- An expired hold frees the slot.
  update public.sponsor_bookings set status = 'lapsed'
  where pool_id = p_pool and round is not distinct from p_round and status = 'held' and held_until <= now();
  select * into q from public.sponsor_quote(p_pool, p_round, s.country);
  if q.pool_id is null or q.price_minor is null then raise exception 'Nothing to sponsor here' using errcode = 'P0001'; end if;
  if not q.available then raise exception 'Already sponsored by %', q.taken_by using errcode = 'P0001'; end if;
  own := q.price_minor * 20 / 100; twin := own; prize := own;
  insert into public.sponsor_bookings (sponsor_id, pool_id, round, kind, players_at_sale, currency, price_minor,
                                       own_school_minor, twin_school_minor, prize_minor, scrumline_minor)
  values (p_sponsor, p_pool, p_round, q.kind, q.players, q.currency, q.price_minor,
          own, twin, prize, q.price_minor - own - twin - prize)
  returning id into new_id;
  return new_id;
end $$;

-- The payment provider confirmed a payment (called only by the webhook
-- function, after it has checked the provider's signature). The amount must
-- match to the cent. Paying fixes the schools' allocations.
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
    return 'slot taken while payment was pending';  -- to be refunded
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
  -- each side adds up to its share exactly. The twin side mirrors the own
  -- side school by school; a school with no twin yet gives to the fund.
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
    from alloc a cross join (values ('own', b.own_school_minor), ('twin', b.twin_school_minor)) sh(share, minor)
  ), amounts as (
    select emis, share, rn, minor, minor * n / total as base from split
  )
  select b.id, case x.share when 'own' then x.emis else t.twin_emis end, x.share,
         sum(x.base + case when x.rn = 1 then x.minor - (select sum(y.base) from amounts y where y.share = x.share) else 0 end),
         b.currency
  from amounts x left join public.school_twins t on t.emis = x.emis
  group by 2, 3;
  return 'ok';
end $$;

-- Approving the logo and offer puts a paid booking live.
create or replace function public.review_sponsor_creative(p_booking bigint, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce((select is_admin from public.members where user_id = auth.uid()), false) then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  update public.sponsor_creatives
  set status = case when p_approve then 'approved' else 'rejected' end, reviewed_by = auth.uid(), reviewed_at = now()
  where booking_id = p_booking;
  if p_approve then
    update public.sponsor_bookings set status = 'live' where id = p_booking and status = 'paid';
  end if;
end $$;

-- A sponsor submits or changes its creative; a change goes back for review.
create or replace function public.save_sponsor_creative(p_booking bigint, p_name text, p_offer text, p_link text, p_prize text, p_logo text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.sponsor_bookings;
begin
  select * into b from public.sponsor_bookings where id = p_booking;
  if b.id is null or not public.manages_sponsor(b.sponsor_id) then raise exception 'Not your booking' using errcode = '42501'; end if;
  insert into public.sponsor_creatives (booking_id, display_name, offer, link, prize_text, logo_path)
  values (p_booking, btrim(p_name), nullif(btrim(p_offer), ''), nullif(btrim(p_link), ''), nullif(btrim(p_prize), ''), p_logo)
  on conflict (booking_id) do update
    set display_name = excluded.display_name, offer = excluded.offer, link = excluded.link,
        prize_text = excluded.prize_text, logo_path = coalesce(excluded.logo_path, public.sponsor_creatives.logo_path),
        status = 'pending', reviewed_by = null, reviewed_at = null;
  -- Off air until the new version is approved.
  update public.sponsor_bookings set status = 'paid' where id = p_booking and status = 'live';
end $$;

-- What players see: the live sponsor of a pool, for the season and for a round.
create or replace function public.pool_sponsors(p_pool bigint)
returns table (booking_id bigint, round int, display_name text, logo_path text, offer text, link text, prize_text text)
language sql stable
security definer
set search_path = public
as $$
  select b.id, b.round, c.display_name, c.logo_path, c.offer, c.link, c.prize_text
  from public.sponsor_bookings b
  join public.sponsor_creatives c on c.booking_id = b.id and c.status = 'approved'
  where b.pool_id = p_pool and b.status = 'live' and public.is_pool_member(p_pool)
$$;

-- A phone reports what its player saw or did. 'seen' counts once per
-- person per day; shares and taps count every time.
create or replace function public.sponsor_event(p_booking bigint, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.sponsor_bookings;
  today date := (now() at time zone 'Africa/Johannesburg')::date;
  fresh int;
begin
  select * into b from public.sponsor_bookings where id = p_booking and status = 'live';
  if b.id is null or not public.is_pool_member(b.pool_id) then return; end if;
  if p_kind = 'seen' then
    insert into public.sponsor_sightings (booking_id, user_id, day) values (b.id, auth.uid(), today)
    on conflict do nothing;
    get diagnostics fresh = row_count;
    if fresh = 0 then return; end if;
  elsif p_kind not in ('share', 'tap') then
    raise exception 'Unknown event' using errcode = '22023';
  end if;
  insert into public.sponsor_daily (booking_id, day, seen, shares, taps)
  values (b.id, today, (p_kind = 'seen')::int, (p_kind = 'share')::int, (p_kind = 'tap')::int)
  on conflict (booking_id, day) do update
    set seen = public.sponsor_daily.seen + excluded.seen,
        shares = public.sponsor_daily.shares + excluded.shares,
        taps = public.sponsor_daily.taps + excluded.taps;
end $$;

-- The sponsor's results page.
create or replace function public.sponsor_results(p_booking bigint)
returns table (players int, reached int, seen int, shares int, taps int,
               own_paid bigint, twin_paid bigint, own_due bigint, twin_due bigint)
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
         coalesce((select sum(amount_minor) from public.school_allocations a where a.booking_id = b.id and a.share = 'twin' and a.status <> 'due'), 0),
         coalesce((select sum(amount_minor) from public.school_allocations a where a.booking_id = b.id and a.share = 'own'), 0),
         coalesce((select sum(amount_minor) from public.school_allocations a where a.booking_id = b.id and a.share = 'twin'), 0)
  from public.sponsor_bookings b
  where b.id = p_booking and public.manages_sponsor(b.sponsor_id)
$$;

-- A school's page: money raised this season and who gave it.
create or replace function public.school_raised(p_emis text, p_season text)
returns table (raised_minor bigint, currency text, sponsors text[])
language sql stable
security definer
set search_path = public
as $$
  select coalesce(sum(a.amount_minor), 0), min(a.currency),
         array_agg(distinct c.display_name) filter (where c.display_name is not null)
  from public.school_allocations a
  join public.sponsor_bookings b on b.id = a.booking_id and b.status in ('paid', 'live', 'ended')
  join public.pools p on p.id = b.pool_id and p.season = p_season
  left join public.sponsor_creatives c on c.booking_id = b.id and c.status = 'approved'
  where a.emis = p_emis and public.is_member()
$$;

-- 10. Access ----------------------------------------------------------------------
alter table public.countries enable row level security;
alter table public.school_twins enable row level security;
alter table public.sponsor_prices enable row level security;
alter table public.sponsors enable row level security;
alter table public.sponsor_managers enable row level security;
alter table public.sponsor_bookings enable row level security;
alter table public.sponsor_creatives enable row level security;
alter table public.school_allocations enable row level security;
alter table public.sponsor_sightings enable row level security;
alter table public.sponsor_daily enable row level security;

revoke all on public.countries, public.school_twins, public.sponsor_prices, public.sponsors, public.sponsor_managers,
  public.sponsor_bookings, public.sponsor_creatives, public.school_allocations, public.sponsor_sightings,
  public.sponsor_daily from anon, authenticated;

-- Reference data anyone signed in may read.
grant select on public.countries, public.school_twins, public.sponsor_prices to authenticated;
create policy "read" on public.countries for select to authenticated using (true);
create policy "read" on public.school_twins for select to authenticated using (true);
create policy "read" on public.sponsor_prices for select to authenticated using (true);

-- A sponsor's own records, for the people who manage it (and admins).
grant select on public.sponsors, public.sponsor_managers, public.sponsor_bookings, public.sponsor_creatives, public.school_allocations to authenticated;
create policy "your sponsor" on public.sponsors for select to authenticated using (public.manages_sponsor(id));
create policy "your sponsor" on public.sponsor_managers for select to authenticated using (public.manages_sponsor(sponsor_id));
create policy "your bookings" on public.sponsor_bookings for select to authenticated using (public.manages_sponsor(sponsor_id));
create policy "your creatives" on public.sponsor_creatives for select to authenticated
  using (exists (select 1 from public.sponsor_bookings b where b.id = booking_id and public.manages_sponsor(b.sponsor_id)));
create policy "your allocations" on public.school_allocations for select to authenticated
  using (exists (select 1 from public.sponsor_bookings b where b.id = booking_id and public.manages_sponsor(b.sponsor_id)));

-- Anyone signed in can set up a sponsor account for their business and
-- becomes its manager. Betting categories don't exist to pick.
create or replace function public.create_sponsor(p_country text, p_name text, p_category text, p_email text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id bigint;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  insert into public.sponsors (country, name, category, email, created_by)
  values (p_country, btrim(p_name), p_category, lower(btrim(p_email)), auth.uid())
  returning id into new_id;
  insert into public.sponsor_managers (sponsor_id, user_id) values (new_id, auth.uid());
  return new_id;
end $$;

revoke execute on function public.manages_sponsor(bigint), public.pool_kind(bigint), public.sponsor_quote(bigint, int, text),
  public.hold_sponsor_slot(bigint, bigint, int), public.sponsor_booking_paid(bigint, text, text, bigint, text),
  public.review_sponsor_creative(bigint, boolean), public.save_sponsor_creative(bigint, text, text, text, text, text),
  public.pool_sponsors(bigint), public.sponsor_event(bigint, text), public.sponsor_results(bigint),
  public.school_raised(text, text), public.create_sponsor(text, text, text, text)
  from public, anon;
grant execute on function public.sponsor_quote(bigint, int, text), public.hold_sponsor_slot(bigint, bigint, int),
  public.review_sponsor_creative(bigint, boolean), public.save_sponsor_creative(bigint, text, text, text, text, text),
  public.pool_sponsors(bigint), public.sponsor_event(bigint, text), public.sponsor_results(bigint),
  public.school_raised(text, text), public.create_sponsor(text, text, text, text), public.manages_sponsor(bigint)
  to authenticated;
revoke execute on function public.sponsor_booking_paid(bigint, text, text, bigint, text) from authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.sponsor_booking_paid(bigint, text, text, bigint, text) to service_role;
  end if;
end $$;
