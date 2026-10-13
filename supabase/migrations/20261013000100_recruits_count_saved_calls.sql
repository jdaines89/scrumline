-- A new player now counts toward the recruiter prize once they have saved
-- calls on at least 3 matches, whether or not those matches have kicked off.
-- Kickoff never proved anyone was real (a fake can save three scores and
-- wait), and it left real players like a same-day joiner showing as "not
-- brought in". The month-end settlement is where fakes get caught.
-- Same signature as before; p_asof is kept so callers don't change.
create or replace function public.recruits_between(p_user uuid, p_from timestamptz, p_to timestamptz, p_asof timestamptz)
returns int
language sql stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.invites i
  where i.invited_by = p_user and i.created_at >= p_from and i.created_at < p_to
    and (select count(distinct p.match_id) from public.entries e
         join public.predictions p on p.entry_id = e.id
         join public.matches m on m.id = p.match_id
         -- Saved before p_asof, or on a match that had kicked off by then (those can't change), so a settled month stays settled.
         where e.user_id = i.invitee_id and (p.updated_at < p_asof or m.kickoff_at < p_asof)) >= 3
$$;
revoke all on function public.recruits_between(uuid, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
