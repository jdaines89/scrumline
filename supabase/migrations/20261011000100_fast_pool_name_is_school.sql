-- Creating a league timed out ("canceling statement due to statement timeout"):
-- pool_name_is_school() normalised all ~25,500 school names on every call (~6s),
-- and a new league runs it once per tournament. Index the normalised keys so the
-- check is a lookup (~1ms). Same results as before.
create or replace function public.pool_name_keys(p text[])
returns text[] language sql immutable set search_path to 'public'
as $$ select coalesce(array_agg(public.pool_name_key(x)), '{}'::text[]) from unnest(p) x $$;

create index if not exists schools_name_key on public.schools (public.pool_name_key(name));
create index if not exists schools_name40_key on public.schools (public.pool_name_key(left(name, 40)));
create index if not exists schools_aka_keys on public.schools using gin (public.pool_name_keys(aka));

create or replace function public.pool_name_is_school(p_name text)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  with k as (select public.pool_name_key(regexp_replace(p_name, '\s*class\s+of\s+\d{4}\s*$', '', 'i')) as v)
  select p_name ~ '[✓✔☑✅]'
      or exists (select 1 from public.schools s where public.pool_name_key(s.name) = (select v from k))
      or exists (select 1 from public.schools s where public.pool_name_key(left(s.name, 40)) = (select v from k))
      or exists (select 1 from public.schools s where public.pool_name_keys(s.aka) @> array[(select v from k)])
$function$;

analyze public.schools;
