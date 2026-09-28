-- Giving: where sponsors' money went, in the open. Every paid sponsorship's
-- school shares, per school and per sponsor, with how much has been paid out
-- and how much the schools have confirmed receiving. Players and business
-- accounts can read it; it shows totals and sponsor names, never who played.

create or replace function public.giving_rows(p_season text, p_currency text)
returns table (booking_id bigint, sponsor_id bigint, sponsor text, category text,
               emis text, share text, amount_minor bigint, status text)
language sql stable
security definer
set search_path = public
as $$
  select b.id, s.id, coalesce(c.display_name, s.name), s.category, a.emis, a.share, a.amount_minor, a.status
  from public.school_allocations a
  join public.sponsor_bookings b on b.id = a.booking_id and b.status in ('paid', 'live', 'ended')
  join public.sponsors s on s.id = b.sponsor_id and not s.blocked
  join public.pools p on p.id = b.pool_id
  left join public.sponsor_creatives c on c.booking_id = b.id and c.status = 'approved'
  where a.currency = p_currency
    and (p_season is null or p.season = p_season)
    and (public.is_member() or public.is_business())
$$;

create or replace function public.giving_totals(p_season text default null, p_currency text default 'ZAR')
returns table (committed_minor bigint, paid_minor bigint, confirmed_minor bigint, schools int, sponsors int)
language sql stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount_minor), 0)::bigint,
         coalesce(sum(amount_minor) filter (where status in ('paid', 'confirmed')), 0)::bigint,
         coalesce(sum(amount_minor) filter (where status = 'confirmed'), 0)::bigint,
         count(distinct emis)::int, count(distinct sponsor_id)::int
  from public.giving_rows(p_season, p_currency)
$$;

create or replace function public.giving_schools(p_season text default null, p_currency text default 'ZAR')
returns table (emis text, name text, town text, no_fee boolean, committed_minor bigint, paid_minor bigint,
               confirmed_minor bigint, sponsors text[])
language sql stable
security definer
set search_path = public
as $$
  -- A share with no school yet (no partner found, or a pool nobody's school
  -- claims) sits in the schools fund for no-fee schools, and is listed as that.
  select g.emis, coalesce(sc.name, 'Schools fund for no-fee schools'), sc.town, coalesce(sc.no_fee, true),
         sum(g.amount_minor)::bigint,
         (sum(g.amount_minor) filter (where g.status in ('paid', 'confirmed')))::bigint,
         (sum(g.amount_minor) filter (where g.status = 'confirmed'))::bigint,
         array_agg(distinct g.sponsor order by g.sponsor)
  from public.giving_rows(p_season, p_currency) g
  left join public.schools sc on sc.emis = g.emis
  group by g.emis, sc.name, sc.town, sc.no_fee
  order by 5 desc, sc.name
  limit 200
$$;

create or replace function public.giving_sponsors(p_season text default null, p_currency text default 'ZAR')
returns table (sponsor text, category text, to_schools_minor bigint, schools int)
language sql stable
security definer
set search_path = public
as $$
  select min(g.sponsor), min(g.category), sum(g.amount_minor)::bigint, count(distinct g.emis)::int
  from public.giving_rows(p_season, p_currency) g
  group by g.sponsor_id
  order by 3 desc, 1
  limit 50
$$;

revoke execute on function public.giving_rows(text, text), public.giving_totals(text, text),
  public.giving_schools(text, text), public.giving_sponsors(text, text) from public, anon;
revoke execute on function public.giving_rows(text, text) from authenticated;
grant execute on function public.giving_totals(text, text), public.giving_schools(text, text),
  public.giving_sponsors(text, text) to authenticated;
