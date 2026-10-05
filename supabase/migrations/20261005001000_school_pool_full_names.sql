-- School leagues carry the school's full name.
--
-- League names are capped at 40 characters, so a class league for a long
-- school name was stored cut short ("Sundays River Primary Sch… Class of
-- 1998"). Schools are the heart of Scrumline and their names are never
-- abbreviated: every school league now also carries full_name, written by
-- the database from the official school list (nobody can set it), and the
-- app shows that.
--
-- Additive only: the stored name stays as it is for anything that reads it.

alter table public.pools add column if not exists full_name text;

create or replace function public.pool_full_name() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.school_emis is null then
    new.full_name := null;
  else
    new.full_name := (select s.name from public.schools s where s.emis = new.school_emis)
                     || case when new.school_year is not null then ' Class of ' || new.school_year else '' end;
  end if;
  return new;
end $$;
revoke all on function public.pool_full_name() from public, anon, authenticated;

create or replace trigger pools_full_name before insert or update on public.pools
  for each row execute function public.pool_full_name();

update public.pools p set full_name = s.name || case when p.school_year is not null then ' Class of ' || p.school_year else '' end
from public.schools s
where s.emis = p.school_emis and p.full_name is distinct from s.name || case when p.school_year is not null then ' Class of ' || p.school_year else '' end;
