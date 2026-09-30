-- Tapping a round prize opens its details: a few lines about the prize (size,
-- colour, how to collect) and the business behind it, with its logo, about
-- text and website. The details go through the same word check as the prize.

alter table public.round_prizes
  add column details text check (length(btrim(details)) between 1 and 280);
grant insert (details) on public.round_prizes to authenticated;

create or replace function public.round_prize_from_business()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select s.name into new.sponsor from public.sponsors s where s.id = new.sponsor_id;
  new.prize := btrim(new.prize);
  new.details := nullif(btrim(coalesce(new.details, '')), '');
  if not public.sponsor_text_ok(new.prize) or not public.sponsor_text_ok(new.details) then
    raise exception 'Some of those words can''t be shown to players. Please reword it.' using errcode = '22023';
  end if;
  return new;
end $$;

drop function public.pool_prizes(bigint);
create function public.pool_prizes(p_pool bigint)
returns table (round integer, sponsor text, prize text, offered_by uuid, status text,
               winners uuid[], received uuid[], due_at timestamptz, image_path text,
               details text, sponsor_about text, sponsor_website text, sponsor_logo text)
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
         rp.details, s.about, s.website, s.logo_path
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
