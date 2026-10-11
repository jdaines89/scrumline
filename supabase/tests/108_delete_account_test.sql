-- A player can delete their account: everything that names them goes, their
-- calls stay as a nameless "Former player", so nobody else's table moves.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  if uid is null then perform set_config('role', 'anon', false); perform set_config('request.jwt.claim.sub', '', false);
  else perform set_config('role', 'authenticated', false); perform set_config('request.jwt.claim.sub', uid::text, false); end if;
end $$;
create function pg_temp.fails(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;

create temp table d as
select (select user_id from public.members where not is_admin order by user_id desc limit 1) as p,
       (select user_id from public.members where is_admin order by user_id limit 1) as admin;
grant select on d to authenticated, anon;
update public.members set avatar_path = (select p from d)::text || '/me.jpg', first_name = 'Delete', last_name = 'Me'
 where user_id = (select p from d);
insert into public.push_subscriptions (endpoint, user_id, p256dh, auth) select 'https://push.test/delete-me', p, repeat('k', 87), repeat('a', 22) from d;
create temp table before as
select (select count(*) from public.predictions pr join public.entries e on e.id = pr.entry_id where e.user_id = (select p from d)) as calls;

select pg_temp.as_user(null);
select pg_temp.check(pg_temp.fails($$select public.delete_my_account('DELETE')$$), 'someone signed out can''t delete anything');
select pg_temp.as_user((select admin from d));
select pg_temp.check(pg_temp.fails($$select public.delete_my_account('DELETE')$$), 'an admin can''t delete themselves here');
select pg_temp.as_user((select p from d));
select pg_temp.check(pg_temp.fails($$select public.delete_my_account('yes')$$), 'it needs DELETE typed to confirm');
create temp table files as select unnest(public.delete_my_account('DELETE')) as path;
reset role;

select pg_temp.check(exists (select 1 from files where path = 'avatars/' || (select p from d)::text || '/me.jpg'), 'the picture is handed back to remove');
select pg_temp.check((select first_name is null and last_name is null and known_as is null and avatar_path is null
                             and display_name like 'Former player %' and team_name like 'Former player %'
                             and email like 'deleted-%@deleted.invalid'
                      from public.members where user_id = (select p from d)), 'names, picture and email are gone');
select pg_temp.check((select email like 'deleted-%' and encrypted_password = '' from auth.users where id = (select p from d)), 'they can''t sign in any more');
select pg_temp.check(not exists (select 1 from public.push_subscriptions where user_id = (select p from d)), 'alerts are off');
select pg_temp.check(not exists (select 1 from public.member_schools where user_id = (select p from d)), 'schools are gone');
select pg_temp.check(not exists (select 1 from public.chat_messages where author_id = (select p from d) and body <> 'Message deleted'), 'chat text is gone');
select pg_temp.check((select count(*) from public.predictions pr join public.entries e on e.id = pr.entry_id where e.user_id = (select p from d)) = (select calls from before),
                     'their calls stay, so tables don''t move');
select pg_temp.check(not exists (select 1 from public.entries where user_id = (select p from d) and team_name not like 'Former player %'), 'every tournament shows the nameless team');

do $$ begin raise notice 'DELETE ACCOUNT CHECKS PASSED'; end $$;

-- Nobody reads another player's email, but the rest of the profile is open to players.
select pg_temp.as_user((select admin from d));
select pg_temp.check(pg_temp.fails($$select email from public.members limit 1$$), 'players can''t read email addresses');
select pg_temp.check(pg_temp.fails($$select * from public.members limit 1$$), 'not even with select *');
select pg_temp.check((select count(*) from (select user_id, display_name, team_name, avatar_path from public.members) x) > 1, 'names and pictures still show');
reset role;
do $$ begin raise notice 'MEMBER EMAIL CHECKS PASSED'; end $$;
