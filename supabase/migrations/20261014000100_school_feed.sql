-- A feed of the good happening at schools, with reactions and comments.
--
-- Before: a school's page lists its projects and the latest photo, and the
-- Giving page lists every project. Nobody can scroll through what is
-- happening across the country, or in one province, and nobody can react.
-- Now:
--   * school_feed() is one feed of project events (opened, fully backed,
--     ordered, delivered, notes), filtered by school or province, newest
--     first. Every post is a project event, so nothing floats loose.
--   * Players react (a fixed emoji set) and comment on a post.
--   * Comments follow the chat rules, held to the strict school list: word
--     filter, bans, flood limits (15 a minute, 100 an hour, the same text on
--     at most 2 posts an hour, links after 3 days), reports (one report
--     holds it for an admin), blocks. Admins review in mod_comment_queue().
-- Additive only: no existing object is changed.

-- A post is a project event: 'opened', 'funded', or 'e<evidence id>'.
create or replace function public.feed_post_ok(p_project bigint, p_post_key text)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.school_projects p where p.id = p_project and p.status <> 'cancelled')
     and (p_post_key in ('opened', 'funded')
          or (p_post_key ~ '^e[0-9]{1,18}$'
              and exists (select 1 from public.project_evidence e
                          where e.project_id = p_project and e.id = substr(p_post_key, 2)::bigint and e.kind <> 'quote')))
$$;
revoke execute on function public.feed_post_ok(bigint, text) from public, anon;
grant execute on function public.feed_post_ok(bigint, text) to authenticated;

create table public.feed_reactions (
  project_id bigint not null references public.school_projects(id) on delete cascade,
  post_key   text not null check (post_key ~ '^(opened|funded|e[0-9]{1,18})$'),
  user_id    uuid not null default auth.uid() references public.members(user_id) on delete cascade,
  emoji      text not null check (emoji in ('👍', '🔥', '🏉', '😢', '😮', '😂')),
  created_at timestamptz not null default now(),
  primary key (project_id, post_key, user_id, emoji)
);
alter table public.feed_reactions enable row level security;
alter table public.feed_reactions force row level security;
revoke all on public.feed_reactions from anon, authenticated;
grant select on public.feed_reactions to authenticated;
grant insert (project_id, post_key, user_id, emoji) on public.feed_reactions to authenticated;
grant delete on public.feed_reactions to authenticated;
create policy "read reactions" on public.feed_reactions for select to authenticated using (public.is_member());
create policy "react as yourself" on public.feed_reactions for insert to authenticated
  with check (user_id = auth.uid() and public.is_member() and public.feed_post_ok(project_id, post_key));
create policy "remove your own reaction" on public.feed_reactions for delete to authenticated
  using (user_id = auth.uid());

create table public.feed_comments (
  id         bigint generated always as identity primary key,
  project_id bigint not null references public.school_projects(id) on delete cascade,
  post_key   text not null check (post_key ~ '^(opened|funded|e[0-9]{1,18})$'),
  author_id  uuid not null default auth.uid() references public.members(user_id) on delete cascade,
  body       text not null check (length(body) <= 500),
  hidden_at  timestamptz,
  created_at timestamptz not null default now(),
  check (hidden_at is not null or length(btrim(body)) >= 1)
);
create index feed_comments_post on public.feed_comments (project_id, post_key, id);
create index feed_comments_author on public.feed_comments (author_id, created_at desc);
alter table public.feed_comments enable row level security;
alter table public.feed_comments force row level security;
revoke all on public.feed_comments from anon, authenticated;
grant select on public.feed_comments to authenticated;
grant insert (project_id, post_key, author_id, body) on public.feed_comments to authenticated;
grant delete on public.feed_comments to authenticated;
-- People you blocked don't show up, as in chat.
create policy "read comments" on public.feed_comments for select to authenticated
  using (public.is_member()
         and not exists (select 1 from public.member_blocks b where b.blocker = auth.uid() and b.blocked = author_id));
create policy "comment as yourself" on public.feed_comments for insert to authenticated
  with check (author_id = auth.uid() and public.is_member() and public.feed_post_ok(project_id, post_key));
create policy "delete your own comment" on public.feed_comments for delete to authenticated
  using (author_id = auth.uid());

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.feed_comments;
  end if;
end $$;

-- Moderation: the chat rules, always on the strict (school) list ----------------

create or replace function moderation.comment_flood_kind(p_user uuid, p_project bigint, p_post_key text, p_body text)
returns text
language plpgsql stable
security definer
set search_path = public, moderation
as $$
declare
  txt text := lower(btrim(coalesce(p_body, '')));
begin
  if p_user is null or exists (select 1 from public.members where user_id = p_user and is_admin) then return null; end if;
  if (select count(*) from public.feed_comments where author_id = p_user and created_at > now() - interval '1 minute') >= 15 then
    return 'burst';
  end if;
  if (select count(*) from public.feed_comments where author_id = p_user and created_at > now() - interval '1 hour') >= 100 then
    return 'hour';
  end if;
  if char_length(txt) >= 15 and (select count(distinct (project_id, post_key)) from public.feed_comments
       where author_id = p_user and created_at > now() - interval '1 hour'
         and (project_id, post_key) is distinct from (p_project, p_post_key) and lower(btrim(body)) = txt) >= 2 then
    return 'copy';
  end if;
  if txt ~ '(https?://|www\.|\m[a-z0-9-]{2,}\.(com|net|org|io|co|xyz|ly|me|app|link|info|biz|top|click|shop|site|online|live)(/|\M))'
     and exists (select 1 from public.members where user_id = p_user and joined_at > now() - interval '3 days') then
    return 'link';
  end if;
  return null;
end $$;
revoke execute on function moderation.comment_flood_kind(uuid, bigint, text, text) from public, anon, authenticated;

-- The app's check before sending: null when the comment can go, else why not.
create or replace function public.comment_check(p_project bigint, p_post_key text, p_body text)
returns text
language plpgsql
security definer
set search_path = public, moderation
as $$
declare
  me uuid := auth.uid();
  cat text := moderation.verdict(p_body);
  until timestamptz := moderation.muted_until(me);
  kind text;
begin
  if not public.is_member() or not public.feed_post_ok(p_project, p_post_key) then return 'That post is no longer there.'; end if;
  if until is not null then return 'You can''t post in chat until ' || moderation.when_text(until) || '.'; end if;
  kind := moderation.comment_flood_kind(me, p_project, p_post_key, p_body);
  if kind in ('copy', 'link') then
    insert into moderation.caught (user_id, place, pool_id, body, category) values (me, 'comment', null, left(p_body, 1000), 'spam');
    if (select count(*) from moderation.caught
         where user_id = me and category = 'spam' and created_at > now() - interval '24 hours') >= 3 then
      until := moderation.mute(me, 'Spamming chats');
      return moderation.flood_text(kind) || ' You can''t post in chat until ' || moderation.when_text(until) || '.';
    end if;
  end if;
  if kind is not null then return moderation.flood_text(kind); end if;
  if not moderation.blocks(cat, true) then return null; end if;
  insert into moderation.caught (user_id, place, pool_id, body, category) values (me, 'comment', null, left(p_body, 1000), cat);
  if cat in ('hate', 'threat') and (select count(*) from moderation.caught
       where user_id = me and category in ('hate', 'threat') and created_at > now() - interval '24 hours') >= 3 then
    until := moderation.mute(me, 'Three blocked messages in a day');
    return moderation.refusal(cat) || ' You can''t post in chat until ' || moderation.when_text(until) || '.';
  end if;
  return moderation.refusal(cat);
end $$;
revoke execute on function public.comment_check(bigint, text, text) from anon, public;
grant execute on function public.comment_check(bigint, text, text) to authenticated;

-- The same rules on the table, whatever the app does.
create or replace function moderation.check_comment()
returns trigger
language plpgsql
security definer
set search_path = public, moderation
as $$
declare
  until timestamptz := moderation.muted_until(new.author_id);
  cat text := moderation.verdict(new.body);
  kind text := moderation.comment_flood_kind(new.author_id, new.project_id, new.post_key, new.body);
begin
  if until is not null then
    raise exception 'You can''t post in chat until %.', moderation.when_text(until) using errcode = '42501';
  end if;
  if kind is not null then raise exception '%', moderation.flood_text(kind) using errcode = '22023'; end if;
  if moderation.blocks(cat, true) then raise exception '%', moderation.refusal(cat) using errcode = '22023'; end if;
  return new;
end $$;
create or replace trigger feed_comments_moderate before insert on public.feed_comments
  for each row execute function moderation.check_comment();

-- Reports: one report holds a comment (school content is held at 1, as in school chats).
create table public.feed_comment_reports (
  comment_id bigint not null references public.feed_comments(id) on delete cascade,
  reporter   uuid not null default auth.uid() references public.members(user_id) on delete cascade,
  reason     text not null check (reason in ('hate', 'bullying', 'sexual', 'other')),
  created_at timestamptz not null default now(),
  primary key (comment_id, reporter)
);
alter table public.feed_comment_reports enable row level security;
alter table public.feed_comment_reports force row level security;
revoke all on public.feed_comment_reports from anon, authenticated;
grant select on public.feed_comment_reports to authenticated;
grant insert (comment_id, reporter, reason) on public.feed_comment_reports to authenticated;
create policy "your comment reports" on public.feed_comment_reports for select to authenticated using (reporter = auth.uid());
create policy "report what you can read" on public.feed_comment_reports for insert to authenticated
  with check (reporter = auth.uid() and exists (select 1 from public.feed_comments c where c.id = comment_id and c.author_id <> auth.uid()));

create table moderation.held_comments (
  comment_id bigint primary key references public.feed_comments(id) on delete cascade,
  body       text not null,
  held_at    timestamptz not null default now(),
  decided    text check (decided in ('kept', 'removed')),
  decided_at timestamptz,
  decided_by uuid references public.members(user_id) on delete set null
);

create or replace function moderation.hold_comment_on_report()
returns trigger
language plpgsql
security definer
set search_path = public, moderation, notify
as $$
declare
  c public.feed_comments;
begin
  select * into c from public.feed_comments where id = new.comment_id;
  if c.id is null or c.hidden_at is not null
     or exists (select 1 from moderation.held_comments where comment_id = c.id and decided = 'kept') then
    return null;
  end if;
  insert into moderation.held_comments (comment_id, body) values (c.id, c.body)
  on conflict (comment_id) do update set body = excluded.body, held_at = now(), decided = null, decided_at = null, decided_by = null;
  update public.feed_comments set body = '', hidden_at = now() where id = c.id;
  begin
    insert into notify.push_outbox (user_id, title, body, url, tag)
    select m.user_id, 'Comment held', 'A school feed comment was reported. Tap to review.',
           notify.app_link('admin/moderation/'), 'moderation'
    from public.members m
    where m.is_admin and exists (select 1 from public.push_subscriptions s where s.user_id = m.user_id);
    perform notify.kick_push();
  exception when others then
    raise warning 'moderation push skipped: %', sqlerrm;
  end;
  return null;
end $$;
create trigger feed_comment_reports_hold after insert on public.feed_comment_reports
  for each row execute function moderation.hold_comment_on_report();

-- Admin review of held comments.
create or replace function public.mod_comment_queue()
returns table (comment_id bigint, school text, project text, author_id uuid, author_name text, body text, held_at timestamptz,
               reasons text, author_removed int)
language plpgsql stable
security definer
set search_path = public, moderation
as $$
begin
  perform moderation.require_admin();
  return query
  select h.comment_id, s.name, p.title, c.author_id, a.display_name, h.body, h.held_at,
         (select string_agg(distinct r.reason, ', ') from public.feed_comment_reports r where r.comment_id = h.comment_id),
         (select count(*)::int from moderation.removed x where x.author_id = c.author_id and x.removed_at > now() - interval '30 days')
  from moderation.held_comments h
  join public.feed_comments c on c.id = h.comment_id
  join public.school_projects p on p.id = c.project_id
  join public.schools s on s.emis = p.emis
  left join public.members a on a.user_id = c.author_id
  where h.decided is null
  order by h.held_at;
end $$;
revoke execute on function public.mod_comment_queue() from anon, public;
grant execute on function public.mod_comment_queue() to authenticated;

create or replace function public.mod_comment_decide(p_comment bigint, p_action text)
returns text
language plpgsql
security definer
set search_path = public, moderation
as $$
declare
  h moderation.held_comments;
  c public.feed_comments;
  why text;
  until timestamptz;
begin
  perform moderation.require_admin();
  select * into h from moderation.held_comments where comment_id = p_comment and decided is null;
  select * into c from public.feed_comments where id = p_comment;
  if h.comment_id is null or c.id is null then return 'Already decided'; end if;
  if p_action = 'keep' then
    update public.feed_comments set body = h.body, hidden_at = null where id = p_comment;
    update moderation.held_comments set decided = 'kept', decided_at = now(), decided_by = auth.uid() where comment_id = p_comment;
    return 'Kept';
  elsif p_action in ('remove', 'ban') then
    select coalesce(string_agg(distinct reason, ', '), '') into why from public.feed_comment_reports where comment_id = p_comment;
    insert into moderation.removed (author_id, pool_id, body, reasons, removed_by) values (c.author_id, null, h.body, why, auth.uid());
    delete from public.feed_comments where id = p_comment;
    if p_action = 'ban' then
      insert into moderation.mutes (user_id, until, reason) values (c.author_id, 'infinity', 'Banned by an admin');
      return 'Removed, and banned from chat';
    end if;
    if (select count(*) from moderation.removed where author_id = c.author_id and removed_at > now() - interval '30 days') >= 2 then
      until := moderation.mute(c.author_id, 'Two messages removed in 30 days', interval '7 days');
      return 'Removed. No chat for them until ' || moderation.when_text(until);
    end if;
    return 'Removed';
  end if;
  raise exception 'Unknown action %', p_action;
end $$;
revoke execute on function public.mod_comment_decide(bigint, text) from anon, public;
grant execute on function public.mod_comment_decide(bigint, text) to authenticated;

-- The feed -------------------------------------------------------------------

-- Newest first. p_emis: one school's feed; p_province: schools in one province
-- (the government's two-letter code); neither: the whole country. p_before pages.
create or replace function public.school_feed(
  p_emis text default null, p_province text default null, p_before timestamptz default null, p_limit int default 20)
returns table (project_id bigint, post_key text, at timestamptz, event text, emis text, school text, town text, province text,
               title text, note text, image_path text, reactions jsonb, mine text[], comments int)
language sql stable
security definer
set search_path = public
as $$
  with posts as (
    select p.id as project_id, 'opened'::text as post_key, p.created_at as at, 'opened'::text as event, null::text as note, null::text as image_path
    from public.school_projects p where p.status <> 'cancelled'
    union all
    select p.id, 'funded', p.funded_at, 'funded', null, null
    from public.school_projects p where p.status <> 'cancelled' and p.funded_at is not null
    union all
    select e.project_id, 'e' || e.id, e.at, e.kind, e.note, e.image_path
    from public.project_evidence e join public.school_projects p on p.id = e.project_id
    where p.status <> 'cancelled' and e.kind <> 'quote'
  )
  select x.project_id, x.post_key, x.at, x.event, s.emis, s.name, s.town, s.province, p.title, x.note, x.image_path,
         coalesce((select jsonb_object_agg(r.emoji, r.n) from (
                     select emoji, count(*) as n from public.feed_reactions fr
                     where fr.project_id = x.project_id and fr.post_key = x.post_key group by emoji) r), '{}'::jsonb),
         coalesce((select array_agg(fr.emoji) from public.feed_reactions fr
                   where fr.project_id = x.project_id and fr.post_key = x.post_key and fr.user_id = auth.uid()), '{}'),
         (select count(*)::int from public.feed_comments c
          where c.project_id = x.project_id and c.post_key = x.post_key and c.hidden_at is null
            and not exists (select 1 from public.member_blocks b where b.blocker = auth.uid() and b.blocked = c.author_id))
  from posts x
  join public.school_projects p on p.id = x.project_id
  join public.schools s on s.emis = p.emis
  where public.is_member()
    and (p_emis is null or s.emis = p_emis)
    and (p_province is null or s.province = p_province)
    and (p_before is null or x.at < p_before)
  order by x.at desc, x.project_id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;
revoke execute on function public.school_feed(text, text, timestamptz, int) from anon, public;
grant execute on function public.school_feed(text, text, timestamptz, int) to authenticated;

-- Comments on one post, oldest first, with their authors' names.
create or replace function public.feed_post_comments(p_project bigint, p_post_key text)
returns table (id bigint, author_id uuid, author_name text, avatar_path text, body text, created_at timestamptz, mine boolean)
language sql stable
security definer
set search_path = public
as $$
  select c.id, c.author_id, m.display_name, m.avatar_path, c.body, c.created_at, c.author_id = auth.uid()
  from public.feed_comments c
  left join public.members m on m.user_id = c.author_id
  where public.is_member() and c.project_id = p_project and c.post_key = p_post_key and c.hidden_at is null
    and not exists (select 1 from public.member_blocks b where b.blocker = auth.uid() and b.blocked = c.author_id)
  order by c.id
  limit 200
$$;
revoke execute on function public.feed_post_comments(bigint, text) from anon, public;
grant execute on function public.feed_post_comments(bigint, text) to authenticated;
