-- Every player has a password: the app asks a newcomer who joined by code to choose one.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;

insert into auth.users (id, email, encrypted_password) values
  ('00000000-0000-0000-0000-00000000a001', 'haspw@test', '$2a$10$hash'),
  ('00000000-0000-0000-0000-00000000a002', 'nopw@test', ''),
  ('00000000-0000-0000-0000-00000000a003', 'nullpw@test', null);

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a001', false);
select pg_temp.check(public.i_have_password(), 'a player with a password is never asked again');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a002', false);
select pg_temp.check(not public.i_have_password(), 'a player who joined by code is asked to choose one');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a003', false);
select pg_temp.check(not public.i_have_password(), 'no password at all counts the same');
select set_config('request.jwt.claim.sub', '', false);
reset role;

do $$ begin
  set local role anon;
  perform public.i_have_password();
  raise exception 'FAILED: anon can ask';
exception when insufficient_privilege then raise notice 'ok: someone signed out cannot ask';
end $$;

do $$ begin raise notice 'CHOOSE PASSWORD CHECKS PASSED'; end $$;
