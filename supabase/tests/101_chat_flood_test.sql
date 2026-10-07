-- One person can't flood the chats.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  if uid is null then perform set_config('role', 'anon', false); perform set_config('request.jwt.claim.sub', '', false);
  else perform set_config('role', 'authenticated', false); perform set_config('request.jwt.claim.sub', uid::text, false); end if;
end $$;
create function pg_temp.fails(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;

-- A non-admin player in three chat leagues.
create temp table f as
select pm.user_id as u, array_agg(pm.pool_id order by pm.pool_id) as pools
from public.pool_members pm join public.members m on m.user_id = pm.user_id
where not m.is_admin and public.pool_has_chat(pm.pool_id) and pm.pool_id in (select id from public.pools where school_emis is null)
group by pm.user_id having count(*) >= 3 order by pm.user_id limit 1;
grant select on f to authenticated, anon;
select pg_temp.check((select u is not null from f), 'a player in three leagues found');
update public.members set joined_at = now() - interval '30 days' where user_id = (select u from f);

select pg_temp.as_user((select u from f));
select pg_temp.check(public.chat_check((select pools[1] from f), 'Who is watching the Bulls tonight?') is null, 'a normal message passes');
insert into public.chat_messages (pool_id, body) values ((select pools[1] from f), 'Who is watching the Bulls tonight?');
insert into public.chat_messages (pool_id, body) values ((select pools[2] from f), 'Who is watching the Bulls tonight?');
select pg_temp.check(public.chat_check((select pools[1] from f), 'Who is watching the Bulls tonight?') is null, 'repeating it in a league it is already in is fine');
select pg_temp.check(public.chat_check((select pools[3] from f), 'who is watching the bulls tonight? ') like '%already posted that%', 'the same text in a third league is refused');
select pg_temp.check(pg_temp.fails($$insert into public.chat_messages (pool_id, body) values ((select pools[3] from f), 'Who is watching the Bulls tonight?')$$), 'and the table refuses it too');
select pg_temp.check(public.chat_check((select pools[3] from f), 'Go Bokke!') is null, 'short cheers can go anywhere');
reset role;
select pg_temp.check((select count(*) from moderation.caught where user_id = (select u from f) and category = 'spam') = 1, 'a copy-paste refusal is recorded as spam');

select pg_temp.as_user((select u from f));
select public.chat_check((select pools[3] from f), 'Who is watching the Bulls tonight?');
select pg_temp.check(public.chat_check((select pools[3] from f), 'Who is watching the Bulls tonight?') like '%can''t post in chat until%', 'the third spam refusal in a day takes them off chat');
reset role;
update moderation.mutes set lifted_at = now() where user_id = (select u from f);
delete from moderation.caught where user_id = (select u from f);

-- Links wait for 3 days.
update public.members set joined_at = now() - interval '1 day' where user_id = (select u from f);
select pg_temp.as_user((select u from f));
select pg_temp.check(public.chat_check((select pools[1] from f), 'Win big at cheapbets.xyz now') like '%links after%', 'a new player can''t post a link');
select pg_temp.check(public.chat_check((select pools[1] from f), 'see https://example.org/x') like '%links after%', 'nor a full web address');
select pg_temp.check(public.chat_check((select pools[1] from f), 'Kick-off is at 5.30, see you there') is null, 'times and full stops are not links');
reset role;
update public.members set joined_at = now() - interval '30 days' where user_id = (select u from f);
select pg_temp.as_user((select u from f));
select pg_temp.check(public.chat_check((select pools[1] from f), 'Great read: https://example.org/x') is null, 'after 3 days links are fine');

-- At most 15 messages a minute.
reset role;
delete from public.chat_messages where author_id = (select u from f) and created_at > now() - interval '2 hours';
select pg_temp.as_user((select u from f));
do $$ begin for i in 1..15 loop
  insert into public.chat_messages (pool_id, body) values ((select pools[1] from f), 'msg ' || i);
end loop; end $$;
select pg_temp.check(public.chat_check((select pools[2] from f), 'one more') like 'Slow down%', 'the 16th message in a minute is refused');
select pg_temp.check(pg_temp.fails($$insert into public.chat_messages (pool_id, body) values ((select pools[2] from f), 'one more')$$), 'by the table too');
reset role;

-- Admins are not limited.
select pg_temp.check(moderation.flood_kind((select user_id from public.members where is_admin limit 1), (select pools[3] from f), 'Who is watching the Bulls tonight? https://x.com') is null
  or not exists (select 1 from public.members where is_admin), 'admins are not limited');

delete from public.chat_messages where author_id = (select u from f) and created_at > now() - interval '5 minutes';
delete from moderation.caught where user_id = (select u from f);
do $$ begin raise notice 'CHAT FLOOD CHECKS PASSED'; end $$;
