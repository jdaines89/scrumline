-- Players can't read each other's email or reminder settings; they still see names, and their own details.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;

select set_config('role', 'authenticated', false), set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  perform email from public.members;
  raise exception 'FAILED: a player read other players'' emails';
exception when insufficient_privilege then raise notice 'ok: other players'' emails are hidden';
end $$;
do $$ begin
  perform reminder_by, push_mentions, push_results, email_reminders, school_asked_at from public.members;
  raise exception 'FAILED: a player read other players'' settings';
exception when insufficient_privilege then raise notice 'ok: other players'' settings are hidden';
end $$;
select pg_temp.check((select count(*) from public.members where display_name is not null) > 1, 'players still see each other''s names');
select pg_temp.check((select count(*) from public.my_member()) = 1, 'my_member returns only you');
select pg_temp.check((select user_id::text from public.my_member()) = '00000000-0000-0000-0000-00000000000a', 'and it is you');
select pg_temp.check((select email from public.my_member()) is not null, 'you still see your own email');
update public.members set push_results = false where user_id = '00000000-0000-0000-0000-00000000000a';
select pg_temp.check(not (select push_results from public.my_member()), 'you can still change your own settings');
reset role;
update public.members set push_results = true where user_id = '00000000-0000-0000-0000-00000000000a';
select set_config('role', 'anon', false);
do $$ begin
  perform public.my_member();
  raise exception 'FAILED: signed out could call my_member';
exception when insufficient_privilege then raise notice 'ok: signed out gets nothing';
end $$;
reset role;
select 'PASSED: private member details' as result;
