-- Every player has a password. Joining from an invite signs a newcomer in with
-- a 6-digit email code, so the app asks this once they're in: if the account
-- has no password yet, it shows "Choose a password" before anything else.
-- Only ever answers for the signed-in account, and only yes or no.
--
-- Additive only.

create or replace function public.i_have_password()
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select coalesce((select coalesce(u.encrypted_password, '') <> '' from auth.users u where u.id = auth.uid()), true)
$$;
revoke execute on function public.i_have_password() from public, anon;
grant execute on function public.i_have_password() to authenticated;
