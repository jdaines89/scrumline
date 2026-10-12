-- Pin and mute league chats: each player's own, and muting stops that league's chat pushes.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  if uid is null then perform set_config('role', 'anon', false); perform set_config('request.jwt.claim.sub', '', false);
  else perform set_config('role', 'authenticated', false); perform set_config('request.jwt.claim.sub', uid::text, false); end if;
end $$;
create function pg_temp.fails(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;

-- Two non-admin players sharing a league, and a league the first isn't in.
create temp table cp as
select a.user_id as u, b.user_id as v, a.pool_id as p,
       (select id from public.pools x where not exists (select 1 from public.pool_members y where y.pool_id = x.id and y.user_id = a.user_id) limit 1) as other
from public.pool_members a join public.pool_members b on b.pool_id = a.pool_id and b.user_id <> a.user_id
join public.members ma on ma.user_id = a.user_id and not ma.is_admin
join public.members mb on mb.user_id = b.user_id and not mb.is_admin
order by a.pool_id, a.user_id, b.user_id limit 1;
grant select on cp to authenticated, anon;
select pg_temp.check((select u is not null and other is not null from cp), 'two players in one league found');

select pg_temp.as_user((select u from cp));
insert into public.chat_prefs (pool_id, muted, pinned_at) values ((select p from cp), true, now())
  on conflict (user_id, pool_id) do update set muted = excluded.muted, pinned_at = excluded.pinned_at;
select pg_temp.check((select muted and pinned_at is not null from public.chat_prefs where pool_id = (select p from cp)), 'a normal player can pin and mute their league');
update public.chat_prefs set pinned_at = null where pool_id = (select p from cp);
select pg_temp.check((select pinned_at is null from public.chat_prefs where pool_id = (select p from cp)), 'and unpin it');
select pg_temp.check((select muted from public.chat_unread where pool_id = (select p from cp)), 'the unread counts know it is muted');
update public.chat_prefs set muted = false, tags_only = true where pool_id = (select p from cp);
select pg_temp.check((select tags_only and not muted from public.chat_unread where pool_id = (select p from cp)), 'tags only is kept apart from mute');
update public.chat_prefs set muted = true, tags_only = false where pool_id = (select p from cp);
select pg_temp.check(pg_temp.fails($$insert into public.chat_prefs (pool_id, muted) values ((select other from cp), true)$$), 'not a league they are not in');
select pg_temp.check(pg_temp.fails($$insert into public.chat_prefs (user_id, pool_id, muted) values ((select v from cp), (select p from cp), true)$$), 'nor for someone else');

select pg_temp.as_user((select v from cp));
select pg_temp.check((select count(*) from public.chat_prefs) = 0, 'nobody else sees your choices');
select pg_temp.check((select not muted from public.chat_unread where pool_id = (select p from cp)), 'and it stays unmuted for them');
reset role;

insert into notify.push_outbox (user_id, title, body, url, tag)
  select u, 'x tagged you', 'hi', 'chat/', 'chat-' || p from cp
  union all select v, 'x tagged you', 'hi', 'chat/', 'chat-' || p from cp
  union all select u, 'Kickoff', 'call', '/', 'kickoff' from cp;
select pg_temp.check((select count(*) from notify.push_outbox where user_id = (select u from cp) and tag = 'chat-' || (select p from cp)) = 0, 'a muted league sends no chat push');
select pg_temp.check((select count(*) from notify.push_outbox where user_id = (select v from cp) and tag = 'chat-' || (select p from cp)) = 1, 'others in the league still get theirs');
select pg_temp.check((select count(*) from notify.push_outbox where user_id = (select u from cp) and tag = 'kickoff') = 1, 'other pushes still go');
delete from notify.push_outbox where body in ('hi', 'call') and user_id in (select u from cp union select v from cp);
