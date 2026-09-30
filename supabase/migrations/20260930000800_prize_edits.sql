-- A business can fix its round prize (the prize, its details, its photo) up
-- to 48 hours before the round's first kickoff. After that it's locked, so
-- players know what they're playing for; withdrawing still closes at kickoff.

create or replace function public.round_first_kickoff(p_pool bigint, p_round integer)
returns timestamptz
language sql stable security definer
set search_path = public
as $$
  select min(m.kickoff_at) from public.matches m join public.pools p on p.season = m.season
  where p.id = p_pool and m.round = p_round
$$;
revoke all on function public.round_first_kickoff(bigint, integer) from public, anon;
grant execute on function public.round_first_kickoff(bigint, integer) to authenticated;

create or replace function public.edit_round_prize(p_pool bigint, p_round integer, p_prize text, p_details text, p_image_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rp public.round_prizes;
begin
  select * into rp from public.round_prizes where pool_id = p_pool and round = p_round;
  if rp.pool_id is null or rp.offered_by is distinct from auth.uid()
     or not exists (select 1 from public.my_businesses() b where b.id = rp.sponsor_id) then
    raise exception 'Only the business that offered this prize can change it' using errcode = '42501';
  end if;
  if coalesce(public.round_first_kickoff(p_pool, p_round) - interval '48 hours' <= now(), true) then
    raise exception 'Prizes lock 48 hours before the round kicks off' using errcode = '42501';
  end if;
  if not public.sponsor_text_ok(p_prize) or not public.sponsor_text_ok(p_details) then
    raise exception 'Some of those words can''t be shown to players. Please reword it.' using errcode = '22023';
  end if;
  update public.round_prizes
  set prize = btrim(p_prize),
      details = nullif(btrim(coalesce(p_details, '')), ''),
      image_path = nullif(p_image_path, '')
  where pool_id = p_pool and round = p_round;
end $$;
revoke all on function public.edit_round_prize(bigint, integer, text, text, text) from public, anon;
grant execute on function public.edit_round_prize(bigint, integer, text, text, text) to authenticated;

drop function public.pool_prizes(bigint);
create function public.pool_prizes(p_pool bigint)
returns table (round integer, sponsor text, prize text, offered_by uuid, status text,
               winners uuid[], received uuid[], due_at timestamptz, image_path text,
               details text, sponsor_about text, sponsor_website text, sponsor_logo text,
               edit_until timestamptz)
language sql stable security definer
set search_path = public
as $$
  select rp.round, rp.sponsor, rp.prize, rp.offered_by,
         case when not o.started then 'upcoming'
              when not o.complete then 'in play'
              when o.winners is null then 'no winner'
              when o.winners <@ coalesce(rc.received, '{}') then 'delivered'
              when o.due_at < now() then 'not delivered'
              else 'awaiting' end,
         o.winners, coalesce(rc.received, '{}'), o.due_at, rp.image_path,
         rp.details, s.about, s.website, s.logo_path,
         public.round_first_kickoff(rp.pool_id, rp.round) - interval '48 hours'
  from public.round_prizes rp
  cross join lateral public.prize_outcome(rp.pool_id, rp.round) o
  left join public.sponsors s on s.id = rp.sponsor_id
  left join lateral (select array_agg(pr.user_id) as received from public.prize_receipts pr
                     where pr.pool_id = rp.pool_id and pr.round = rp.round) rc on true
  where rp.pool_id = p_pool and public.is_pool_member(p_pool)
  order by rp.round
$$;
revoke all on function public.pool_prizes(bigint) from public, anon;
grant execute on function public.pool_prizes(bigint) to authenticated;
