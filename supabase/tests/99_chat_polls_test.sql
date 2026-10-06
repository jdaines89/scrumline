-- Polls in league chat.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  if uid is null then perform set_config('role', 'anon', false); perform set_config('request.jwt.claim.sub', '', false);
  else perform set_config('role', 'authenticated', false); perform set_config('request.jwt.claim.sub', uid::text, false); end if;
end $$;
create function pg_temp.fails(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;

-- A league with chat, two of its players, and someone outside it.
create temp table t as
select p.id as pool, (array_agg(pm.user_id order by pm.user_id))[1] as a, (array_agg(pm.user_id order by pm.user_id))[2] as b,
       (select m.user_id from public.members m where not exists (select 1 from public.pool_members x where x.pool_id = p.id and x.user_id = m.user_id) limit 1) as outsider
from public.pools p join public.pool_members pm on pm.pool_id = p.id
where public.pool_has_chat(p.id) and p.school_emis is null
group by p.id having count(*) >= 2 order by p.id limit 1;
grant select on t to authenticated, anon;
select pg_temp.check((select pool is not null and outsider is not null from t), 'test league found');

select pg_temp.as_user((select a from t));
create temp table t_poll as select public.post_poll((select pool from t), '  Who wins the derby?  ', array['Bulls', ' Stormers ', 'Draw']) as id;
reset role;
grant select on t_poll to authenticated, anon;
select pg_temp.check((select body from public.chat_messages where id = (select id from t_poll)) = 'Who wins the derby?', 'the question is posted as a chat message');
select pg_temp.check((select options from public.chat_polls where message_id = (select id from t_poll)) = array['Bulls', 'Stormers', 'Draw'], 'with its answers, tidied');

select pg_temp.as_user((select a from t));
select pg_temp.check(pg_temp.fails($$select public.post_poll((select pool from t), 'One answer?', array['Only'])$$), 'a poll needs at least 2 answers');
select pg_temp.check(pg_temp.fails($$select public.post_poll((select pool from t), 'Same?', array['Yes', 'yes'])$$), 'answers must be different');
select pg_temp.check(pg_temp.fails($$select public.post_poll((select pool from t), 'Blank?', array['Yes', '  '])$$), 'every answer needs words');
insert into public.chat_poll_votes (message_id, choice) values ((select id from t_poll), 0);
insert into public.chat_poll_votes (message_id, choice) values ((select id from t_poll), 2)
  on conflict (message_id, user_id) do update set choice = excluded.choice;
select pg_temp.check(pg_temp.fails($$insert into public.chat_poll_votes (message_id, choice) values ((select id from t_poll), 3) on conflict (message_id, user_id) do update set choice = excluded.choice$$), 'a vote must be one of the answers');
reset role;
select pg_temp.check((select choice from public.chat_poll_votes where message_id = (select id from t_poll) and user_id = (select a from t)) = 2, 'a player can change their vote');

select pg_temp.as_user((select b from t));
insert into public.chat_poll_votes (message_id, choice) values ((select id from t_poll), 1);
select pg_temp.check((select count(*) from public.chat_poll_votes where message_id = (select id from t_poll)) = 2, 'league mates see every vote');
select pg_temp.check(pg_temp.fails($$insert into public.chat_poll_votes (message_id, user_id, choice) values ((select id from t_poll), (select a from t), 0)$$), 'nobody votes for someone else');
select pg_temp.check(pg_temp.fails($$insert into public.chat_polls (message_id, options) values ((select id from t_poll), array['x', 'y'])$$), 'nobody adds answers to someone else''s question');
update public.chat_poll_votes set choice = 0 where user_id = (select a from t);
reset role;
select pg_temp.check((select choice from public.chat_poll_votes where message_id = (select id from t_poll) and user_id = (select a from t)) = 2, 'nobody changes someone else''s vote');

select pg_temp.as_user((select outsider from t));
select pg_temp.check(not exists (select 1 from public.chat_polls where message_id = (select id from t_poll)), 'someone outside the league can''t see the poll');
select pg_temp.check(not exists (select 1 from public.chat_poll_votes where message_id = (select id from t_poll)), 'or its votes');
select pg_temp.check(pg_temp.fails($$insert into public.chat_poll_votes (message_id, choice) values ((select id from t_poll), 0)$$), 'or vote in it');
select pg_temp.check(pg_temp.fails($$select public.post_poll((select pool from t), 'Sneaky?', array['a', 'b'])$$), 'or post a poll there');
reset role;

select pg_temp.as_user(null);
select pg_temp.check(pg_temp.fails($$select public.post_poll(1, 'Anon?', array['a', 'b'])$$), 'signed out, nobody posts a poll');
reset role;

-- The way the app votes: through vote_in_poll, first time and changing it.
select pg_temp.as_user((select b from t));
select pg_temp.check(pg_temp.fails($$insert into public.chat_poll_votes (message_id, choice) values ((select id from t_poll), 2)
  on conflict (message_id, user_id) do update set message_id = excluded.message_id, choice = excluded.choice$$), 'a player can''t move their vote to another poll');
select public.vote_in_poll((select id from t_poll), 2::smallint);
reset role;
select pg_temp.check((select choice from public.chat_poll_votes where message_id = (select id from t_poll) and user_id = (select b from t)) = 2, 'vote_in_poll changes a vote');
select pg_temp.as_user((select outsider from t));
select pg_temp.check(pg_temp.fails($$select public.vote_in_poll((select id from t_poll), 0::smallint)$$), 'vote_in_poll won''t let an outsider vote');
reset role;

-- Replies (the app sends reply_to with the message), including to a photo.
select pg_temp.as_user((select b from t));
select pg_temp.check(not pg_temp.fails($$insert into public.chat_messages (pool_id, body, reply_to) values ((select pool from t), 'Bulls by 10', (select id from t_poll))$$), 'a player can reply to a message');
reset role;
select pg_temp.check(exists (select 1 from public.chat_messages where body = 'Bulls by 10' and reply_to = (select id from t_poll)), 'the reply points at the message it answers');

-- Closing a poll: only whoever asked, and votes stop.
select pg_temp.as_user((select b from t));
select pg_temp.check(pg_temp.fails($$select public.close_poll((select id from t_poll))$$), 'only the person who asked can close a poll');
select pg_temp.as_user((select a from t));
select public.close_poll((select id from t_poll));
reset role;
select pg_temp.check((select closed_at is not null from public.chat_polls where message_id = (select id from t_poll)), 'the person who asked can close it');
select pg_temp.as_user((select b from t));
select pg_temp.check(pg_temp.fails($$select public.vote_in_poll((select id from t_poll), 0::smallint)$$), 'nobody can change their vote once it is closed');
reset role;
select pg_temp.check((select choice from public.chat_poll_votes where message_id = (select id from t_poll) and user_id = (select b from t)) = 2, 'and the results stay as they were');

do $$ begin raise notice 'CHAT POLL CHECKS PASSED'; end $$;
