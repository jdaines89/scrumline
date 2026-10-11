-- Trial (temporary, 2026-10-11): switch off the two school rules while the
-- school table is tried out with a handful of players.
--   * every schoolmate counts without needing two vouches;
--   * one player is enough for a school's round to count (was 10).
-- Vouches are still recorded. To bring both rules back, make
-- school_rules_relaxed() return false and set SCHOOL_TRIAL = false in
-- src/lib/school.ts.

create or replace function public.school_rules_relaxed() returns boolean language sql immutable as $$ select true $$;

create or replace function public.school_round_minimum() returns int language sql immutable as $$
  select case when public.school_rules_relaxed() then 1 else 10 end
$$;

create or replace view public.school_members with (security_invoker = true) as
select ms.user_id, ms.stage, ms.emis, ms.last_year,
       count(v.voucher_id)::int as vouches,
       (count(v.voucher_id) >= 2 or public.school_rules_relaxed()) as verified
from public.member_schools ms
left join public.school_vouches v
  on v.member_id = ms.user_id and v.stage = ms.stage and v.emis = ms.emis
 and exists (select 1 from public.member_schools vs
             where vs.user_id = v.voucher_id and vs.stage = v.stage and vs.emis = v.emis)
group by ms.user_id, ms.stage, ms.emis, ms.last_year;

-- Sponsor money keeps the real rule: a school slot still opens only once 5
-- players have two vouches each, trial or not.
CREATE OR REPLACE FUNCTION public.slot_block(p_pool bigint, p_round integer, p_sponsor bigint DEFAULT NULL::bigint)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    where sm.emis = p.school_emis and sm.stage = p.school_stage and sm.vouches >= 2;
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
end $function$;
