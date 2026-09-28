-- Reaching the schools that are owed money, and telling a second person
-- from a school straight away who already looks after it.

-- Schools owed money that nobody has claimed, biggest first: the short list
-- to phone. For a no-fee school, the fee schools it partners (and who looks
-- after them) are the natural introduction; for any school, its players are.
create or replace function public.admin_unclaimed_owed(p_limit int default 100)
returns table (emis text, school text, town text, district text, province text, no_fee boolean,
               owed_minor bigint, since timestamptz, players int, introduced_by text)
language sql stable
security definer
set search_path = public
as $$
  with owed as (
    select a.emis, sum(a.amount_minor)::bigint as owed, min(b.paid_at) as since
    from public.school_allocations a
    join public.sponsor_bookings b on b.id = a.booking_id and b.status in ('paid', 'live', 'ended')
    where a.status = 'due' and a.payout_id is null and a.emis is not null and a.currency = 'ZAR'
      and not exists (select 1 from public.school_claims c where c.emis = a.emis and c.status in ('verified', 'needs_review'))
    group by a.emis
  )
  select s.emis, s.name, s.town, s.district, s.province, s.no_fee, o.owed, o.since,
         (select count(distinct ms.user_id) from public.member_schools ms where ms.emis = s.emis)::int,
         (select string_agg(f.name || coalesce(' (' || coalesce(sa.contact_name, c.contact_name) || ')', ''), ', ' order by f.name)
          from public.school_partners p join public.schools f on f.emis = p.emis
          left join public.school_claims c on c.emis = p.emis and c.status = 'verified'
          left join public.school_accounts sa on sa.user_id = c.user_id
          where p.partner_emis = s.emis)
  from owed o join public.schools s on s.emis = o.emis
  where public.is_admin_caller()
  order by o.owed desc, s.name
  limit greatest(1, least(p_limit, 500))
$$;

-- Who already looks after a school, for another school contact picking it.
create or replace function public.school_claim_holder(p_emis text)
returns table (contact_name text, role text, status text)
language sql stable
security definer
set search_path = public
as $$
  select coalesce(a.contact_name, c.contact_name), coalesce(a.role, c.contact_role), c.status
  from public.school_claims c left join public.school_accounts a on a.user_id = c.user_id
  where c.emis = p_emis and c.status in ('verified', 'needs_review')
    and c.user_id is distinct from auth.uid()
    and public.is_school_account()
$$;

revoke execute on function public.admin_unclaimed_owed(int), public.school_claim_holder(text) from public, anon;
grant execute on function public.admin_unclaimed_owed(int), public.school_claim_holder(text) to authenticated;
