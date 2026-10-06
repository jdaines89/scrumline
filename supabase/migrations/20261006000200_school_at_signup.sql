-- Ask for your school once, right after your name.
--
-- New players (and anyone already playing without a school) see a "Where did
-- you go to school?" step once. Saving a school puts them in its league and
-- their class league straight away (member_schools already does that through
-- sync_school_pools). school_asked_at records that the question was shown,
-- whether they answered or tapped "Skip for now", so it is never asked twice;
-- they can still add a school on their profile later.

alter table public.members add column if not exists school_asked_at timestamptz;

grant update (school_asked_at) on public.members to authenticated;
