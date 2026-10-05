-- Two small things for schools.
--
-- 1. The "For schools" page asks a teacher to pick their school before
--    anything else. They aren't signed in yet, so the picker needs a search
--    that works signed out. It returns only what the government's public
--    school list already shows (EMIS number, name, town, no-fee), never
--    anything about Scrumline players or claims.
--
-- 2. A project shows why it's needed: photos taken when it is listed (the
--    broken tap, the worn kit, the empty shelf), next to the order and
--    delivery photos it already gets. They live in their own table so the
--    existing evidence rules stay as they are.
--
-- Additive only.

create or replace function public.find_school(p_query text)
returns table (emis text, name text, town text, no_fee boolean)
language sql stable
security definer
set search_path = public
as $$
  with q as (select school_key(p_query) as k),
  words as (select '%' || w || '%' as pat from q, regexp_split_to_table(q.k, ' ') w where w <> '')
  select s.emis, s.name, s.town, s.no_fee
  from public.schools s, q
  where length(q.k) >= 3 and length(q.k) <= 80
    and school_key(s.name || ' ' || array_to_string(s.aka, ' ')) like all (select pat from words)
  order by (school_key(s.name) like q.k || '%' or exists (select 1 from unnest(s.aka) a where school_key(a) like q.k || '%')) desc,
           s.learners desc nulls last, s.name
  limit 8
$$;

revoke all on function public.find_school(text) from public;
grant execute on function public.find_school(text) to anon, authenticated;

create table if not exists public.project_need_photos (
  id         bigint generated always as identity primary key,
  project_id bigint not null references public.school_projects(id),
  image_path text not null check (image_path ~ '^\d+/[A-Za-z0-9_-]{1,64}\.jpg$'),
  caption    text check (length(btrim(caption)) between 1 and 120),
  posted_by  uuid references auth.users(id) default auth.uid(),
  at         timestamptz not null default now(),
  check (split_part(image_path, '/', 1) = project_id::text)
);
create index if not exists project_need_photos_project on public.project_need_photos (project_id);
alter table public.project_need_photos enable row level security;
revoke all on public.project_need_photos from anon, authenticated;

-- Up to four, and only while the project is still open for backing: once
-- people have pledged against what they saw, the picture doesn't change.
create or replace function public.admin_add_need_photo(p_project bigint, p_image_path text, p_caption text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_caller() then raise exception 'Admins only' using errcode = '42501'; end if;
  if not exists (select 1 from public.school_projects where id = p_project and status = 'active' and funded_at is null) then
    raise exception 'Photos of the need go on before the project is fully backed';
  end if;
  if (select count(*) from public.project_need_photos where project_id = p_project) >= 4 then
    raise exception 'Four photos is enough';
  end if;
  insert into public.project_need_photos (project_id, image_path, caption)
  values (p_project, p_image_path, nullif(btrim(coalesce(p_caption, '')), ''));
end $$;

-- Same audience as the projects themselves.
create or replace function public.project_need_photos_list()
returns table (project_id bigint, image_path text, caption text, at timestamptz)
language sql stable
security definer
set search_path = public
as $$
  select n.project_id, n.image_path, n.caption, n.at
  from public.project_need_photos n
  join public.school_projects p on p.id = n.project_id
  where p.status <> 'cancelled'
    and (public.is_member() or public.is_business() or public.is_school_account())
  order by n.project_id, n.at
$$;

revoke all on function public.admin_add_need_photo(bigint, text, text), public.project_need_photos_list() from public, anon;
grant execute on function public.admin_add_need_photo(bigint, text, text), public.project_need_photos_list() to authenticated;
