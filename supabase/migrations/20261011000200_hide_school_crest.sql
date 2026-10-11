-- Hide a school's crest if the school asks.
--
-- Crests found on schools' Wikipedia pages and websites are now shown
-- straight away (Justin, 11 Oct 2026: "we can hide them if anyone complains").
-- An admin can take any one down from the school's page. The picture is kept
-- in the school's folder and the crest goes back on the found list as set
-- aside, so it is never shown again unless someone puts it back on purpose.
-- The school's own verified contact can still upload their real crest.
--
-- Additive only.

create or replace function public.hide_school_crest(p_emis text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.school_crests;
begin
  if not exists (select 1 from public.members where user_id = auth.uid() and is_admin) then
    raise exception 'Only an admin can hide a crest' using errcode = '42501';
  end if;
  select * into c from public.school_crests where emis = p_emis for update;
  if not found then return; end if;
  insert into public.school_crest_finds (emis, image_path, source_url, status, decided_by, decided_at)
  values (p_emis, c.image_path, 'hidden by admin', 'set_aside', auth.uid(), now())
  on conflict (emis) do update set image_path = excluded.image_path, status = 'set_aside',
    decided_by = excluded.decided_by, decided_at = excluded.decided_at;
  delete from public.school_crests where emis = p_emis;
end $$;
revoke execute on function public.hide_school_crest(text) from public, anon;
grant execute on function public.hide_school_crest(text) to authenticated;
