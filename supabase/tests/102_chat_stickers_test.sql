-- Rugby stickers in league chat.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;
create function pg_temp.fails(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;

create temp table s as
select pm.pool_id as pool, pm.user_id as u from public.pool_members pm
where public.pool_has_chat(pm.pool_id) order by pm.pool_id, pm.user_id limit 1;
grant select on s to authenticated;

select set_config('role', 'authenticated', false), set_config('request.jwt.claim.sub', (select u::text from s), false);
insert into public.chat_messages (pool_id, body, sticker) values ((select pool from s), 'Yellow card', 'yellow_card');
select pg_temp.check((select sticker from public.chat_messages where author_id = (select u from s) order by id desc limit 1) = 'yellow_card', 'a normal player can send a sticker');
select pg_temp.check(pg_temp.fails($$insert into public.chat_messages (pool_id, body, sticker) values ((select pool from s), 'x', '<script>')$$), 'a sticker key must be a plain name');
reset role;
delete from public.chat_messages where author_id = (select u from s) and sticker is not null;
do $$ begin raise notice 'CHAT STICKER CHECKS PASSED'; end $$;
