-- Prize photo uploads were always refused. Inside the policies' subquery,
-- the bare `name` meant my_businesses().name (the business name), not the
-- file's path, so the folder check never matched. Qualify it.

drop policy "businesses add prize photos" on storage.objects;
drop policy "businesses remove prize photos" on storage.objects;

create policy "businesses add prize photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'prize-photos' and (storage.foldername(objects.name))[1] ~ '^\d+$'
              and exists (select 1 from public.my_businesses() b where b.id = ((storage.foldername(objects.name))[1])::bigint));
create policy "businesses remove prize photos" on storage.objects for delete to authenticated
  using (bucket_id = 'prize-photos' and (storage.foldername(objects.name))[1] ~ '^\d+$'
         and exists (select 1 from public.my_businesses() b where b.id = ((storage.foldername(objects.name))[1])::bigint));
