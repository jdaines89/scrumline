-- Players could read every other player's email (and reminder settings),
-- because members had a plain table-wide select grant. Now other players
-- see only what the app shows about people; your own email and settings
-- come from my_member().
revoke select on public.members from authenticated, anon;
grant select (user_id, display_name, first_name, last_name, known_as, team_name,
              avatar_path, is_admin, joined_at)
  on public.members to authenticated;

create or replace function public.my_member()
returns setof public.members
language sql stable security definer set search_path = ''
as $$ select * from public.members where user_id = auth.uid() $$;
revoke execute on function public.my_member() from public, anon;
grant execute on function public.my_member() to authenticated;
