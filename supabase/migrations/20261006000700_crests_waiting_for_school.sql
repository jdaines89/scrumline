-- Crests waiting for their school's yes.
--
-- Scrumline finds a school's crest on its own (from the school's Wikipedia
-- article) and keeps it out of sight. Nobody sees it on the school's page, in
-- the schools table or next to its league. When someone from the school claims
-- it and is verified, the school's own page asks them: "Is this your crest?"
-- "Use this crest" puts it up as the school's crest, exactly as if they had
-- uploaded it. "Not ours" sets it aside for good, and they can upload the
-- right one. Admins see the found crests so a wrong match can be set aside
-- before a school ever sees it.
--
-- The picture sits in the school's folder of the school-crests bucket under a
-- random name that nothing points to until the school says yes.
--
-- Additive only.

create table if not exists public.school_crest_finds (
  emis        text primary key references public.schools(emis),
  image_path  text not null check (image_path ~ '^[0-9]{6,12}/[A-Za-z0-9-]+\.png$'),
  source_url  text not null,  -- where it was found, shown to the school and to admins
  found_at    timestamptz not null default now(),
  status      text not null default 'waiting' check (status in ('waiting', 'used', 'not_ours', 'set_aside')),
  decided_by  uuid,
  decided_at  timestamptz
);
alter table public.school_crest_finds enable row level security;
-- No policies: read and decided only through the functions below.
revoke all on public.school_crest_finds from anon, authenticated;

-- The crest found for a school, for its verified contact (or an admin), while
-- the school has no crest of its own and nobody has decided yet.
create or replace function public.crest_find(p_emis text)
returns table (image_path text, source_url text)
language sql stable
security definer
set search_path = public
as $$
  select f.image_path, f.source_url
  from public.school_crest_finds f
  where f.emis = p_emis and f.status = 'waiting'
    and public.can_set_crest(p_emis)
    and not exists (select 1 from public.school_crests c where c.emis = p_emis)
$$;
revoke execute on function public.crest_find(text) from public, anon;
grant execute on function public.crest_find(text) to authenticated;

-- The school's answer. Only the school's verified contact can say "use it":
-- that yes is the permission. An admin can only set a wrong match aside.
create or replace function public.decide_crest_find(p_emis text, p_use boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.school_crest_finds;
  is_school boolean := exists (select 1 from public.school_claims c where c.emis = p_emis and c.user_id = auth.uid() and c.status = 'verified');
  is_admin boolean := exists (select 1 from public.members where user_id = auth.uid() and is_admin);
begin
  if not (is_school or is_admin) then raise exception 'Only the school can answer for its crest' using errcode = '42501'; end if;
  if p_use and not is_school then raise exception 'Only the school can say yes to its crest' using errcode = '42501'; end if;
  select * into f from public.school_crest_finds where emis = p_emis and status = 'waiting' for update;
  if not found then raise exception 'There''s no crest waiting for this school' using errcode = '22023'; end if;
  if p_use then
    insert into public.school_crests (emis, image_path, set_by) values (p_emis, f.image_path, auth.uid())
    on conflict (emis) do update set image_path = excluded.image_path, set_by = excluded.set_by, set_at = now();
  end if;
  update public.school_crest_finds
     set status = case when p_use then 'used' when is_school then 'not_ours' else 'set_aside' end,
         decided_by = auth.uid(), decided_at = now()
   where emis = p_emis;
end $$;
revoke execute on function public.decide_crest_find(text, boolean) from public, anon;
grant execute on function public.decide_crest_find(text, boolean) to authenticated;

-- Every found crest still waiting, for the admin page.
create or replace function public.admin_crest_finds()
returns table (emis text, school text, town text, province text, image_path text, source_url text, found_at timestamptz, claimed boolean)
language sql stable
security definer
set search_path = public
as $$
  select f.emis, s.name, s.town, s.province, f.image_path, f.source_url, f.found_at,
         exists (select 1 from public.school_claims c where c.emis = f.emis and c.status = 'verified')
  from public.school_crest_finds f
  join public.schools s on s.emis = f.emis
  where f.status = 'waiting'
    and exists (select 1 from public.members where user_id = auth.uid() and is_admin)
  order by s.province, s.name
$$;
revoke execute on function public.admin_crest_finds() from public, anon;
grant execute on function public.admin_crest_finds() to authenticated;
