-- League pictures: whoever started a mates' league can give it a picture, like
-- a WhatsApp group's. The phone crops and shrinks it (256 x 256 JPEG) before
-- upload. The bucket is private: only players in that league can see it,
-- through a short-lived signed link. Files sit under <league id>/..., and only
-- the league's starter can add or remove them. School leagues keep their crest.

alter table public.pools add column if not exists picture_path text;
alter table public.pools add constraint pools_picture_path_own
  check (picture_path is null or picture_path ~ ('^' || id::text || '/[A-Za-z0-9_-]{1,64}\.jpg$'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('league-pictures', 'league-pictures', false, 262144, array['image/jpeg'])
on conflict (id) do nothing;

-- The league a picture belongs to, from its folder; null for anything else.
create or replace function public.league_picture_pool(p_name text)
returns bigint language sql immutable as $$
  select case when (storage.foldername(p_name))[1] ~ '^[0-9]{1,18}$' then ((storage.foldername(p_name))[1])::bigint end
$$;

-- Whether you started this league (and it isn't a school league).
create or replace function public.started_league(p_pool bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pools where id = p_pool and created_by = auth.uid() and school_emis is null)
$$;
revoke execute on function public.started_league(bigint) from public, anon;
grant execute on function public.started_league(bigint) to authenticated;

create policy "league players see its picture" on storage.objects for select to authenticated
  using (bucket_id = 'league-pictures' and public.is_pool_member(public.league_picture_pool(name)));

create policy "league starter adds its picture" on storage.objects for insert to authenticated
  with check (bucket_id = 'league-pictures' and public.started_league(public.league_picture_pool(name)));

create policy "league starter removes its picture" on storage.objects for delete to authenticated
  using (bucket_id = 'league-pictures' and public.started_league(public.league_picture_pool(name)));

-- Whoever started a mates' league sets or clears its picture.
create or replace function public.set_league_picture(p_pool bigint, p_path text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.started_league(p_pool) then
    raise exception 'Only whoever started this league can change its picture' using errcode = '42501';
  end if;
  update public.pools set picture_path = p_path where id = p_pool;
end $$;
revoke execute on function public.set_league_picture(bigint, text) from public, anon;
grant execute on function public.set_league_picture(bigint, text) to authenticated;
