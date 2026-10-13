-- A personal invite link changes by itself after 20 joins.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;
create function pg_temp.me() returns void language sql as
  $$ select set_config('role', 'authenticated', false), set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false) $$;

select pg_temp.me();
select public.reset_invite_code();
select code as rotcode from public.my_invite() \gset
select pg_temp.check((select used from public.my_invite()) = 0, 'a fresh link starts at 0 of 20');
reset role;
insert into auth.users (id, email, invited_at, raw_user_meta_data)
  select ('00000000-0000-0000-0000-000000f7a0' || lpad(g::text, 2, '0'))::uuid, 'rot' || g || '@example.com', now(), '{}'
  from generate_series(1, 20) g;
set role service_role;
select public.invite_record(('00000000-0000-0000-0000-000000f7a0' || lpad(g::text, 2, '0'))::uuid, '00000000-0000-0000-0000-00000000000a', 'rot' || g || '@example.com')
  from generate_series(1, 19) g;
reset role;
select pg_temp.me();
select pg_temp.check((select code = :'rotcode' and used = 19 from public.my_invite()), '19 joins keep the same link');
reset role;
set role service_role;
select public.invite_record('00000000-0000-0000-0000-000000f7a020', '00000000-0000-0000-0000-00000000000a', 'rot20@example.com');
select pg_temp.check((select problem from public.invite_check(:'rotcode', 'late@example.com')) like '%isn''t valid%', 'the 20th join retires the link');
reset role;
select pg_temp.me();
select pg_temp.check((select code <> :'rotcode' and used = 0 from public.my_invite()), 'and the player gets a fresh one with a clean count');
reset role;
select 'PASSED: invite rotation' as result;
