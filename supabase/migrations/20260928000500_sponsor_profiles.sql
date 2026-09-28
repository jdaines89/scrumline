-- Business profiles: a logo, a few lines about the business and its website,
-- so players can learn who is backing their school. The business edits its
-- own profile; players see it wherever the sponsor appears (the sponsor line
-- in a pool, the Giving page). Words go through the same check as sponsor
-- lines, and anything it catches is refused with a plain message, so nothing
-- waits for a person.

alter table public.sponsors
  add column about     text check (length(btrim(about)) between 1 and 280),
  add column website   text check (website ~* '^https://[^\s]+$' and length(website) <= 200),
  add column logo_path text;
alter table public.sponsors add constraint sponsors_logo_own
  check (logo_path is null or logo_path ~ ('^' || id::text || '/[A-Za-z0-9_-]{1,64}\.png$'));

-- Logos are public (they are the business's own advert), small and square.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sponsor-logos', 'sponsor-logos', true, 262144, array['image/png'])
on conflict (id) do nothing;

create policy "sponsors add their logo" on storage.objects for insert to authenticated
  with check (bucket_id = 'sponsor-logos' and (storage.foldername(name))[1] ~ '^\d+$'
              and public.manages_sponsor(((storage.foldername(name))[1])::bigint));
create policy "sponsors remove their logo" on storage.objects for delete to authenticated
  using (bucket_id = 'sponsor-logos' and (storage.foldername(name))[1] ~ '^\d+$'
         and public.manages_sponsor(((storage.foldername(name))[1])::bigint));

create or replace function public.save_sponsor_profile(p_sponsor bigint, p_name text, p_about text, p_website text, p_logo_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.manages_sponsor(p_sponsor) then raise exception 'Not your business' using errcode = '42501'; end if;
  if not public.sponsor_text_ok(p_name) or not public.sponsor_text_ok(p_about) or not public.sponsor_text_ok(p_website) then
    raise exception 'Some of those words can''t be shown to players. Please reword it.' using errcode = '22023';
  end if;
  update public.sponsors
  set name = btrim(p_name),
      about = nullif(btrim(coalesce(p_about, '')), ''),
      website = nullif(btrim(coalesce(p_website, '')), ''),
      logo_path = nullif(p_logo_path, '')
  where id = p_sponsor;
end $$;
revoke execute on function public.save_sponsor_profile(bigint, text, text, text, text) from public, anon;
grant execute on function public.save_sponsor_profile(bigint, text, text, text, text) to authenticated;

-- The sponsor line now carries the profile, so a tap can show it.
drop function public.pool_sponsors(bigint);
create function public.pool_sponsors(p_pool bigint)
returns table (booking_id bigint, round int, display_name text, logo_path text, offer text, link text, prize_text text,
               about text, website text)
language sql stable
security definer
set search_path = public
as $$
  select b.id, b.round, c.display_name, coalesce(s.logo_path, c.logo_path), c.offer, c.link, c.prize_text, s.about, s.website
  from public.sponsor_bookings b
  join public.sponsors s on s.id = b.sponsor_id and not s.blocked
  join public.sponsor_creatives c on c.booking_id = b.id and c.status = 'approved'
  where b.pool_id = p_pool and b.status = 'live' and public.is_pool_member(p_pool)
$$;
revoke execute on function public.pool_sponsors(bigint) from public, anon;
grant execute on function public.pool_sponsors(bigint) to authenticated;

-- The Giving page's sponsors, with their profiles.
drop function public.giving_sponsors(text, text);
create function public.giving_sponsors(p_season text default null, p_currency text default 'ZAR')
returns table (sponsor text, category text, to_schools_minor bigint, schools int, logo_path text, about text, website text)
language sql stable
security definer
set search_path = public
as $$
  select min(g.sponsor), min(g.category), sum(g.amount_minor)::bigint, count(distinct g.emis)::int,
         min(s.logo_path), min(s.about), min(s.website)
  from public.giving_rows(p_season, p_currency) g
  join public.sponsors s on s.id = g.sponsor_id
  group by g.sponsor_id
  order by 3 desc, 1
  limit 50
$$;
revoke execute on function public.giving_sponsors(text, text) from public, anon;
grant execute on function public.giving_sponsors(text, text) to authenticated;
