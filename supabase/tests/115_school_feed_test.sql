-- The school feed, reactions and comments, with chat moderation.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  if uid is null then perform set_config('role', 'anon', false); perform set_config('request.jwt.claim.sub', '', false);
  else perform set_config('role', 'authenticated', false); perform set_config('request.jwt.claim.sub', uid::text, false); end if;
end $$;
create function pg_temp.fails(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;

-- Two non-admin players, one school, one project with a delivery photo.
create temp table f as
select (select user_id from public.members where not is_admin order by user_id limit 1) as a,
       (select user_id from public.members where not is_admin order by user_id offset 1 limit 1) as b,
       (select emis from public.schools order by emis limit 1) as emis;
grant select on f to authenticated, anon;
select pg_temp.check((select a is not null and b is not null from f), 'two players found');
update public.members set joined_at = now() - interval '30 days' where user_id in (select a from f union select b from f);

insert into public.school_projects (emis, title, why, items, supplier, price_minor, deadline, status, funded_at)
  select emis, 'Library shelf', 'Books for the children', '300 story books', 'A Books', 1000000, current_date + 30, 'active', now() from f;
select id as proj from public.school_projects where title = 'Library shelf' order by id desc limit 1 \gset
insert into public.project_evidence (project_id, kind, note, image_path)
  values (:proj, 'delivery', 'The books arrived', :proj || '/abc.jpg'), (:proj, 'quote', 'Quote from the supplier', null);
select ('e' || id) as epost from public.project_evidence where project_id = :proj and kind = 'delivery' \gset

-- The feed.
select pg_temp.as_user((select a from f));
select pg_temp.check((select count(*) from public.school_feed((select emis from f))) >= 3, 'the school feed shows opened, funded and the delivery');
select pg_temp.check(not exists (select 1 from public.school_feed((select emis from f)) where note = 'Quote from the supplier'), 'supplier quotes stay out of the feed');
select pg_temp.check((select count(*) from public.school_feed(null, 'ZZ')) = 0, 'a province filter with no schools is empty');
select pg_temp.check((select count(*) from public.school_feed((select emis from f), null, null, 1)) = 1, 'the limit works');
reset role;
select pg_temp.as_user(null);
select pg_temp.check(pg_temp.fails($$select * from public.school_feed()$$), 'signed-out visitors cannot read the feed');
reset role;


-- Real numbers for the feed.
select pg_temp.as_user((select a from f));
select pg_temp.check((select items = '300 story books' and backers = 0 from public.feed_project_facts(array[:proj])), 'project facts show what was bought');
select pg_temp.check((select delivered >= 0 and schools >= 1 from public.feed_totals()), 'the totals strip has figures');
reset role;
select pg_temp.as_user(null);
select pg_temp.check(pg_temp.fails($$select * from public.feed_totals()$$), 'signed-out visitors cannot read the totals');
reset role;

-- Reactions.
select pg_temp.as_user((select a from f));
insert into public.feed_reactions (project_id, post_key, emoji) values (:proj, :'epost', '🔥');
select pg_temp.check(pg_temp.fails(format($$insert into public.feed_reactions (project_id, post_key, emoji) values (%s, 'e999999999', '🔥')$$, :proj)), 'no reaction on a post that does not exist');
select pg_temp.check(pg_temp.fails(format($$insert into public.feed_reactions (project_id, post_key, emoji) values (%s, 'e%s', '💩')$$, :proj, 1)), 'only the fixed emoji');
select pg_temp.check((select (reactions->>'🔥')::int = 1 and mine = array['🔥'] from public.school_feed((select emis from f)) where post_key = :'epost'), 'the feed counts reactions and shows mine');
insert into public.feed_reactions (project_id, post_key, emoji) values (:proj, :'epost', '😮');
select pg_temp.check((select mine = array['😮'] and (reactions->>'😮')::int = 1 and coalesce((reactions->>'🔥')::int, 0) = 0 from public.school_feed((select emis from f)) where post_key = :'epost'), 'reacting again swaps the earlier reaction, one per player per post');
insert into public.feed_reactions (project_id, post_key, emoji) values (:proj, :'epost', '🔥');
reset role;
select pg_temp.as_user((select b from f));
select pg_temp.check(pg_temp.fails(format($$delete from public.feed_reactions where project_id = %s$$, :proj)) = false
  and (select count(*) from public.feed_reactions) = 1, 'you cannot remove someone else''s reaction');
reset role;

-- Comments.
select pg_temp.as_user((select a from f));
select pg_temp.check(public.comment_check(:proj, :'epost', 'What a gift for the children!') is null, 'a kind comment passes');
insert into public.feed_comments (project_id, post_key, body) values (:proj, :'epost', 'What a gift for the children!');
select pg_temp.check((select comments = 1 from public.school_feed((select emis from f)) where post_key = :'epost'), 'the feed counts comments');
select pg_temp.check(public.comment_check(:proj, 'e999999999', 'hello there') like '%no longer there%', 'no comment on a missing post');
select pg_temp.check(pg_temp.fails(format($$insert into public.feed_comments (project_id, post_key, body, author_id) values (%s, '%s', 'pretend', '%s')$$, :proj, :'epost', (select b from f))), 'you cannot comment as someone else');
reset role;
-- A word on the list is refused by the app check and by the table.
insert into moderation.terms (term, category) values ('zzbadword', 'hate') on conflict do nothing;
select pg_temp.as_user((select a from f));
select pg_temp.check(public.comment_check(:proj, :'epost', 'you zzbadword') is not null, 'a banned word is refused');
select pg_temp.check(pg_temp.fails(format($$insert into public.feed_comments (project_id, post_key, body) values (%s, '%s', 'you zzbadword')$$, :proj, :'epost')), 'and the table refuses it too');
reset role;
delete from moderation.caught where user_id = (select a from f);
delete from moderation.terms where term = 'zzbadword';

-- Links wait for 3 days.
update public.members set joined_at = now() - interval '1 day' where user_id = (select a from f);
select pg_temp.as_user((select a from f));
select pg_temp.check(public.comment_check(:proj, :'epost', 'win at cheapbets.xyz') like '%links after%', 'a new player cannot post a link');
reset role;
update public.members set joined_at = now() - interval '30 days' where user_id = (select a from f);
delete from moderation.caught where user_id = (select a from f);

-- Reports hold a comment until an admin decides; a block hides it.
select pg_temp.as_user((select b from f));
select id as cid from public.feed_comments where project_id = :proj limit 1 \gset
select pg_temp.check((select count(*) from public.feed_post_comments(:proj, :'epost')) = 1, 'the comment is readable');
insert into public.feed_comment_reports (comment_id, reason) values (:cid, 'bullying');
select pg_temp.check((select count(*) from public.feed_post_comments(:proj, :'epost')) = 0, 'a reported comment is held out of sight at once');
select pg_temp.check(pg_temp.fails(format($$insert into public.feed_comment_reports (comment_id, reason) values (%s, 'other')$$, :cid)) = true, 'a second report by the same player is refused');
reset role;
select pg_temp.check((select body = '' and hidden_at is not null from public.feed_comments where id = :cid), 'the words moved out of the comment');
select pg_temp.check((select body = 'What a gift for the children!' from moderation.held_comments where comment_id = :cid), 'and are kept for the admin');

-- Admin decides.
select pg_temp.as_user((select user_id from public.members where is_admin order by user_id limit 1));
select pg_temp.check((select count(*) from public.mod_comment_queue()) = 1, 'the admin sees the held comment');
select pg_temp.check(public.mod_comment_decide(:cid, 'keep') = 'Kept', 'keep puts it back');
reset role;
select pg_temp.check((select body = 'What a gift for the children!' and hidden_at is null from public.feed_comments where id = :cid), 'the comment is restored');
select pg_temp.as_user((select a from f));
select pg_temp.check(pg_temp.fails($$select * from public.mod_comment_queue()$$), 'players cannot open the admin queue');
reset role;

-- Blocks hide a person's comments.
insert into public.member_blocks (blocker, blocked) select b, a from f;
select pg_temp.as_user((select b from f));
select pg_temp.check((select count(*) from public.feed_post_comments(:proj, :'epost')) = 0, 'a blocked person''s comments are hidden');
reset role;

-- Replies and comment reactions.
delete from public.member_blocks;
select pg_temp.as_user((select a from f));
insert into public.feed_comments (project_id, post_key, body) values (:proj, :'epost', 'First!');
select id as c1 from public.feed_comments where project_id = :proj and body = 'First!' \gset
reset role;
select pg_temp.as_user((select b from f));
insert into public.feed_comments (project_id, post_key, body, reply_to) values (:proj, :'epost', 'Replying', :c1);
select id as c2 from public.feed_comments where project_id = :proj and body = 'Replying' \gset
insert into public.feed_comments (project_id, post_key, body, reply_to) values (:proj, :'epost', 'Reply to the reply', :c2);
select pg_temp.check((select reply_to = :c1 from public.feed_comments where body = 'Reply to the reply'), 'a reply to a reply stays under the first comment');
select pg_temp.check(pg_temp.fails(format($$insert into public.feed_comments (project_id, post_key, body, reply_to) values (%s, 'opened', 'wrong post', %s)$$, :proj, :c1)), 'a reply must be on the same post');
insert into public.feed_comment_reactions (comment_id, emoji) values (:c1, '🔥');
insert into public.feed_comment_reactions (comment_id, emoji) values (:c1, '😮');
select pg_temp.check((select my_reaction = '😮' and (reactions->>'😮')::int = 1 and coalesce((reactions->>'🔥')::int, 0) = 0 from public.feed_comments_list(:proj, :'epost') where id = :c1), 'one reaction per player per comment, a new one swaps the old');
select pg_temp.check((select reply_to = :c1 from public.feed_comments_list(:proj, :'epost') where id = :c2), 'the list carries reply_to');
select pg_temp.check(pg_temp.fails(format($$insert into public.feed_comment_reactions (comment_id, user_id, emoji) values (%s, '%s', '🔥')$$, :c1, (select a from f))), 'cannot react as someone else');
reset role;
select pg_temp.as_user(null);
select pg_temp.check(pg_temp.fails($$select * from public.feed_comment_reactions$$), 'signed-out visitors cannot read comment reactions');
reset role;
delete from public.feed_comments;

-- Trial posts take real comments and reactions.
select pg_temp.as_user((select a from f));
select pg_temp.check(public.comment_check(-12, 'opened', 'A kind note on the trial post') is null, 'a kind comment on a trial post can go');
insert into public.feed_comments (project_id, post_key, body) values (-12, 'opened', 'A kind note on the trial post');
select pg_temp.check(pg_temp.fails($$insert into public.feed_comments (project_id, post_key, body) values (-12, 'e999', 'no such trial post')$$), 'no comment on a trial post that is not in the list');
select pg_temp.check(pg_temp.fails($$insert into public.feed_comments (project_id, post_key, body) values (-99, 'opened', 'no such trial project')$$), 'no comment on a trial project that is not in the list');
insert into public.feed_reactions (project_id, post_key, emoji) values (-12, 'opened', '🔥');
insert into public.feed_reactions (project_id, post_key, emoji) values (-12, 'opened', '😮');
select pg_temp.check((select mine = array['😮'] and (reactions->>'😮')::int = 1 and comments = 1 from public.feed_trial_state() where project_id = -12 and post_key = 'opened'), 'trial state counts comments, one reaction per player');
reset role;
select pg_temp.as_user((select b from f));
select pg_temp.check((select comments = 1 and mine = '{}' from public.feed_trial_state() where project_id = -12 and post_key = 'opened'), 'another player sees the same trial comment and not my reaction as theirs');
reset role;
select pg_temp.as_user(null);
select pg_temp.check(pg_temp.fails($$select * from public.feed_trial_state()$$), 'signed-out visitors cannot read trial state');
reset role;
delete from public.feed_comments;
delete from public.feed_reactions where project_id < 0;

-- Flood: 15 a minute.
delete from public.member_blocks;
delete from public.feed_comments;
select pg_temp.as_user((select a from f));
select set_config('t.proj', :'proj', false);
do $$ begin
  for i in 1..15 loop
    insert into public.feed_comments (project_id, post_key, body) values (current_setting('t.proj')::bigint, 'opened', 'note ' || i);
  end loop;
end $$;
select pg_temp.check(public.comment_check(:proj, 'opened', 'one more') like 'Slow down%', 'the 16th comment in a minute is refused');
reset role;

-- Removing a project removes its feed rows.
insert into public.feed_reactions (project_id, post_key, user_id, emoji) select :proj, 'opened', a, '🔥' from f;
delete from public.school_projects where id = :proj;
select pg_temp.check(not exists (select 1 from public.feed_reactions where project_id = :proj), 'deleting a project removes its reactions');
delete from public.feed_comments where project_id < 0;
delete from public.feed_reactions where project_id < 0;

delete from public.feed_comments;
delete from moderation.caught where user_id = (select a from f);
delete from moderation.held_comments;
delete from public.school_projects where title = 'Library shelf';
do $$ begin raise notice 'SCHOOL FEED CHECKS PASSED'; end $$;
