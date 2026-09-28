-- Official school pools. Scrumline makes a school's pools itself when
-- players save that school, and the app marks them with a verified tick. A
-- pool anyone starts can't pass itself off as one: its name can't be a
-- school's name or nickname (with or without "Class of YYYY"), and can't
-- carry a tick.
create or replace function public.pool_name_key(p text)
returns text
language sql immutable
set search_path = public
as $$ select replace(public.school_key(p), ' ', '') $$;

create or replace function public.pool_name_is_school(p_name text)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  with k as (select public.pool_name_key(regexp_replace(p_name, '\s*class\s+of\s+\d{4}\s*$', '', 'i')) as v)
  select p_name ~ '[✓✔☑✅]'
      or exists (select 1 from public.schools s, k
                 where public.pool_name_key(s.name) = k.v
                    or public.pool_name_key(left(s.name, 40)) = k.v
                    or k.v = any (select public.pool_name_key(x) from unnest(s.aka) x))
$$;
revoke execute on function public.pool_name_is_school(text) from public, anon;
grant execute on function public.pool_name_is_school(text) to authenticated;

create or replace function public.check_pool_name()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.school_emis is null and public.pool_name_is_school(new.name) then
    raise exception 'That''s a school''s name. Official school pools are made for you when you save your school on your profile, so pick another name.'
      using errcode = '23514';
  end if;
  return new;
end $$;
create trigger pools_check_name before insert or update of name on public.pools
  for each row execute function public.check_pool_name();
