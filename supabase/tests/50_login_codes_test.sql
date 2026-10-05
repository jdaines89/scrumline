-- Sign-in codes: only the join function (service role) can look up emails or send codes.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;

select pg_temp.check(public.login_email_known((select email from auth.users limit 1)), 'a known email is recognised');
select pg_temp.check(public.login_email_known(upper((select email from auth.users limit 1)) || '  '), 'case and spaces don''t matter');
select pg_temp.check(not public.login_email_known('nobody@example.org'), 'an unknown email is not');

set role authenticated;
do $$ begin
  perform public.login_email_known('justin@example.com');
  raise exception 'FAILED: a player could check who has an account';
exception when insufficient_privilege then raise notice 'ok: players can''t check who has an account';
end $$;
do $$ begin
  perform public.send_login_code('justin@example.com', '123456', 'signin');
  raise exception 'FAILED: a player could send sign-in codes';
exception when insufficient_privilege then raise notice 'ok: players can''t send sign-in codes';
end $$;
reset role;
set role anon;
do $$ begin
  perform public.send_login_code('justin@example.com', '123456', 'signin');
  raise exception 'FAILED: anyone could send sign-in codes';
exception when insufficient_privilege then raise notice 'ok: signed-out visitors can''t send sign-in codes';
end $$;
reset role;

do $$ begin raise notice 'LOGIN CODE CHECKS PASSED'; end $$;
