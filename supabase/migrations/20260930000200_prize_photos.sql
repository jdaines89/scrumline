-- A photo of the prize: the business shows what the round's top caller wins
-- (a shirt, a voucher). Photos sit under the business's own folder in a
-- public bucket, like logos, because they are the business's own advert; a
-- photo can only go on a prize from the business it was uploaded for.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('prize-photos', 'prize-photos', true, 1048576, array['image/jpeg'])
on conflict (id) do nothing;

create policy "businesses add prize photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'prize-photos' and (storage.foldername(name))[1] ~ '^\d+$'
              and exists (select 1 from public.my_businesses() b where b.id = ((storage.foldername(name))[1])::bigint));
create policy "businesses remove prize photos" on storage.objects for delete to authenticated
  using (bucket_id = 'prize-photos' and (storage.foldername(name))[1] ~ '^\d+$'
         and exists (select 1 from public.my_businesses() b where b.id = ((storage.foldername(name))[1])::bigint));

alter table public.round_prizes add column image_path text;
alter table public.round_prizes add constraint round_prizes_image_own
  check (image_path is null or image_path ~ ('^' || sponsor_id::text || '/[A-Za-z0-9_-]{1,64}\.jpg$'));
grant insert (image_path) on public.round_prizes to authenticated;

drop function public.pool_prizes(bigint);
create function public.pool_prizes(p_pool bigint)
returns table (round integer, sponsor text, prize text, offered_by uuid, status text,
               winners uuid[], received uuid[], due_at timestamptz, image_path text)
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
         o.winners, coalesce(rc.received, '{}'), o.due_at, rp.image_path
  from public.round_prizes rp
  cross join lateral public.prize_outcome(rp.pool_id, rp.round) o
  left join lateral (select array_agg(pr.user_id) as received from public.prize_receipts pr
                     where pr.pool_id = rp.pool_id and pr.round = rp.round) rc on true
  where rp.pool_id = p_pool and public.is_pool_member(p_pool)
  order by rp.round
$$;
revoke all on function public.pool_prizes(bigint) from public, anon;
grant execute on function public.pool_prizes(bigint) to authenticated;
