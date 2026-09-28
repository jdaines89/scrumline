-- Moderation: Scrumline can't be used to spread racism or bullying.
--
-- Four layers, all automatic unless a person has to judge something:
--   1. A word filter the database enforces on everything people write that
--      others read: chat, display names, team names, pool names and round
--      prizes. Racist and hateful words and threats (like telling someone to
--      kill themselves) are refused everywhere. Sexual words and swearing are
--      refused in names and in school and class pools, where players can be
--      at school; in a private pool of mates, reports handle them instead.
--      The filter sees through the usual dodges: capitals, accents, 4 for a,
--      k-a-f..., repeated letters and * for a vowel.
--   2. Three refused chat messages with hateful words or threats in a day
--      mean no chat for 24 hours; the next time within 30 days, a week.
--   3. Anyone can report a message. It disappears for them at once; with two
--      reports (one in a school or class pool) it is held for everyone, and
--      admins get a push. Held messages stay hidden until an admin keeps or
--      removes them. Two removed messages in 30 days mean a week without chat.
--   4. Anyone can block a person: their messages and tags stop reaching you.
--
-- The word list lives only in the database (moderation.terms), not in this
-- public repository, so it can't be read to find a way round it. Admins add
-- and remove words from the moderation page; the starting list is loaded
-- from the project's private files.

create schema if not exists moderation;
revoke all on schema moderation from anon, authenticated, public;

-- Text as the filter reads it. Only ever compared, never shown.
create or replace function moderation.normalise(p text)
returns text
language plpgsql immutable
set search_path = moderation, public
as $$
declare
  t text := lower(coalesce(p, ''));
  run text;
begin
  t := translate(t, 'áàâäãåāéèêëēíìîïīóòôöõōúùûüūçñ_', 'aaaaaaaeeeeeiiiiioooooouuuuucn ');
  -- Sentence punctuation isn't a letter in disguise.
  t := regexp_replace(t, '[!?.,;:]+(\s|$)', ' \1', 'g');
  t := translate(t, '0134578@$!|€', 'oieastbasiie');
  -- k a f f i r, k.a.f.f.i.r, k-a-f-f-i-r: three or more lone letters in a row become one word.
  for run in select m[1] from regexp_matches(t, '((?:\m[a-z]\M[\s./*-]*){3,})', 'g') as m loop
    t := replace(t, run, regexp_replace(run, '[^a-z]', '', 'g') || ' ');
  end loop;
  return t;
end $$;

-- A listed word as a pattern: each letter may repeat, a vowel may be a *,
-- a space may be missing. whole: the word alone (or plural); otherwise
-- anything that starts with it.
create or replace function moderation.term_pattern(p_term text, p_whole boolean)
returns text
language plpgsql immutable
set search_path = moderation, public
as $$
declare
  body text := '';
  c text;
begin
  foreach c in array regexp_split_to_array(moderation.normalise(btrim(p_term)), '') loop
    body := body || case
      when c ~ '[aeiou]' then '[' || c || '*]+'
      when c ~ '[a-z]' then c || '+'
      when c ~ '\s' then '[\s./*''-]*'
      else '\' || c
    end;
  end loop;
  return '\m' || body || case when p_whole then 's*\M' else '' end;
end $$;

create table moderation.terms (
  term     text primary key check (length(btrim(term)) between 2 and 60 and term = lower(btrim(term))),
  category text not null check (category in ('hate', 'threat', 'sexual', 'swearing')),
  whole    boolean not null default true,
  pattern  text not null default '',
  added_by uuid references public.members(user_id) on delete set null,
  added_at timestamptz not null default now()
);

create or replace function moderation.set_pattern()
returns trigger
language plpgsql
set search_path = moderation, public
as $$
begin
  new.pattern := moderation.term_pattern(new.term, new.whole);
  return new;
end $$;
create trigger terms_pattern before insert or update on moderation.terms
  for each row execute function moderation.set_pattern();

-- Real names that contain a listed word (a place, a school) and are fine.
create table moderation.allowed (
  phrase  text primary key check (length(btrim(phrase)) between 2 and 80 and phrase = lower(btrim(phrase))),
  pattern text not null default ''
);
create or replace function moderation.set_allowed_pattern()
returns trigger
language plpgsql
set search_path = moderation, public
as $$
begin
  new.pattern := moderation.term_pattern(new.phrase, false);
  return new;
end $$;
create trigger allowed_pattern before insert or update on moderation.allowed
  for each row execute function moderation.set_allowed_pattern();

-- The worst category a text trips, or null when it's clean.
create or replace function moderation.verdict(p text)
returns text
language plpgsql stable
set search_path = moderation, public
as $$
declare
  n text := moderation.normalise(p);
  a text;
begin
  for a in select pattern from moderation.allowed where n ~ pattern loop
    n := regexp_replace(n, a, ' ', 'g');
  end loop;
  return (select t.category from moderation.terms t where n ~ t.pattern
          order by array_position(array['hate', 'threat', 'sexual', 'swearing'], t.category)
          limit 1);
end $$;

-- Whether a verdict stops the text. Names and school pools are held to the
-- full list; a private pool of mates only to hate and threats.
create or replace function moderation.blocks(p_category text, p_strict boolean)
returns boolean
language sql immutable
as $$
  select coalesce(p_category in ('hate', 'threat') or (p_strict and p_category is not null), false)
$$;

create or replace function moderation.refusal(p_category text)
returns text
language sql immutable
as $$
  select case p_category
    when 'hate' then 'Not sent. Scrumline doesn''t allow racist or hateful language.'
    when 'threat' then 'Not sent. Scrumline doesn''t allow threats or telling people to hurt themselves.'
    else 'Not sent. Keep it clean here: school players can read this.'
  end
$$;

-- Refused messages, kept for the review page and for chat bans.
create table moderation.caught (
  id         bigint generated always as identity primary key,
  user_id    uuid references public.members(user_id) on delete cascade,
  place      text not null,
  pool_id    bigint references public.pools(id) on delete set null,
  body       text not null,
  category   text not null,
  created_at timestamptz not null default now()
);
create index caught_user on moderation.caught (user_id, created_at);

create table moderation.mutes (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.members(user_id) on delete cascade,
  until      timestamptz not null,
  reason     text not null,
  created_at timestamptz not null default now(),
  lifted_at  timestamptz
);
create index mutes_user on moderation.mutes (user_id, until);

create or replace function moderation.muted_until(p_user uuid)
returns timestamptz
language sql stable
set search_path = moderation, public
as $$
  select max(until) from moderation.mutes where user_id = p_user and lifted_at is null and until > now()
$$;

-- A first ban is a day; another within 30 days is a week.
create or replace function moderation.mute(p_user uuid, p_reason text, p_first interval default interval '24 hours')
returns timestamptz
language plpgsql
set search_path = moderation, public
as $$
declare
  len interval := case when exists (select 1 from moderation.mutes where user_id = p_user
                                    and created_at > now() - interval '30 days')
                       then greatest(p_first, interval '7 days') else p_first end;
  u timestamptz := now() + len;
begin
  insert into moderation.mutes (user_id, until, reason) values (p_user, u, p_reason);
  return u;
end $$;

create or replace function moderation.when_text(p timestamptz)
returns text
language sql stable
as $$
  select case when p = 'infinity' then 'an admin lets you back'
              else to_char(p at time zone 'Africa/Johannesburg', 'Dy DD Mon, HH24:MI') end
$$;

-- The app asks before sending a chat message: null when it can go, else
-- why not. A refusal is recorded, and the third hateful one in a day bans
-- the sender from chat.
create or replace function public.chat_check(p_pool bigint, p_body text)
returns text
language plpgsql
security definer
set search_path = public, moderation
as $$
declare
  me uuid := auth.uid();
  cat text := moderation.verdict(p_body);
  is_strict boolean := exists (select 1 from public.pools where id = p_pool and school_emis is not null);
  until timestamptz := moderation.muted_until(me);
begin
  if not public.is_pool_member(p_pool) then return 'You''re not in this pool.'; end if;
  if until is not null then return 'You can''t post in chat until ' || moderation.when_text(until) || '.'; end if;
  if not moderation.blocks(cat, is_strict) then return null; end if;
  insert into moderation.caught (user_id, place, pool_id, body, category)
  values (me, 'chat', p_pool, left(p_body, 1000), cat);
  if cat in ('hate', 'threat') and (select count(*) from moderation.caught
       where user_id = me and category in ('hate', 'threat') and created_at > now() - interval '24 hours') >= 3 then
    until := moderation.mute(me, 'Three blocked messages in a day');
    return moderation.refusal(cat) || ' You can''t post in chat until ' || moderation.when_text(until) || '.';
  end if;
  return moderation.refusal(cat);
end $$;
revoke execute on function public.chat_check(bigint, text) from anon, public;
grant execute on function public.chat_check(bigint, text) to authenticated;

-- The same rules, enforced on the table, whatever the app does.
create or replace function moderation.check_chat()
returns trigger
language plpgsql
security definer
set search_path = public, moderation
as $$
declare
  until timestamptz := moderation.muted_until(new.author_id);
  cat text;
begin
  if until is not null then
    raise exception 'You can''t post in chat until %.', moderation.when_text(until) using errcode = '42501';
  end if;
  cat := moderation.verdict(new.body);
  if moderation.blocks(cat, exists (select 1 from public.pools where id = new.pool_id and school_emis is not null)) then
    raise exception '%', moderation.refusal(cat) using errcode = '22023';
  end if;
  return new;
end $$;
create trigger chat_messages_moderate before insert on public.chat_messages
  for each row execute function moderation.check_chat();

-- Names are held to the full list. A name that fails is refused, except a
-- brand-new account's, which becomes a plain "Player" name instead so the
-- invite still works.
create or replace function moderation.check_names()
returns trigger
language plpgsql
security definer
set search_path = public, moderation
as $$
begin
  if tg_table_name = 'members' then
    if (tg_op = 'INSERT' or new.display_name is distinct from old.display_name)
       and moderation.verdict(new.display_name) is not null then
      if tg_op = 'INSERT' then
        new.display_name := 'Player ' || upper(left(replace(new.user_id::text, '-', ''), 6));
      else
        raise exception 'That name isn''t allowed. Pick another.' using errcode = '22023';
      end if;
    end if;
  elsif tg_table_name = 'entries' then
    if (tg_op = 'INSERT' or new.team_name is distinct from old.team_name)
       and moderation.verdict(new.team_name) is not null then
      raise exception 'That team name isn''t allowed. Pick another.' using errcode = '22023';
    end if;
  elsif tg_table_name = 'pools' then
    -- School and class pools are named after the school by the app.
    if new.school_emis is null and (tg_op = 'INSERT' or new.name is distinct from old.name)
       and moderation.verdict(new.name) is not null then
      raise exception 'That pool name isn''t allowed. Pick another.' using errcode = '22023';
    end if;
  elsif tg_table_name = 'round_prizes' then
    if moderation.verdict(new.sponsor || ' / ' || new.prize) is not null then
      raise exception 'That prize wording isn''t allowed.' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
create trigger members_moderate before insert or update on public.members
  for each row execute function moderation.check_names();
create trigger entries_moderate before insert or update on public.entries
  for each row execute function moderation.check_names();
create trigger pools_moderate before insert or update on public.pools
  for each row execute function moderation.check_names();
create trigger round_prizes_moderate before insert or update on public.round_prizes
  for each row execute function moderation.check_names();

-- Reports ---------------------------------------------------------------

-- A held message keeps its words here, out of everyone's reach but admins',
-- while the message itself goes blank.
alter table public.chat_messages add column hidden_at timestamptz;
alter table public.chat_messages drop constraint chat_messages_body_check;
alter table public.chat_messages add constraint chat_messages_body_check
  check (length(body) <= 1000 and (hidden_at is not null or image_path is not null or length(btrim(body)) >= 1));

create table moderation.held (
  message_id bigint primary key references public.chat_messages(id) on delete cascade,
  body       text not null,
  image_path text,
  held_at    timestamptz not null default now(),
  decided    text check (decided in ('kept', 'removed')),
  decided_at timestamptz,
  decided_by uuid references public.members(user_id) on delete set null
);

-- What happened to messages an admin removed (the message itself is gone).
create table moderation.removed (
  id         bigint generated always as identity primary key,
  author_id  uuid references public.members(user_id) on delete cascade,
  pool_id    bigint references public.pools(id) on delete set null,
  body       text not null,
  reasons    text not null,
  removed_at timestamptz not null default now(),
  removed_by uuid references public.members(user_id) on delete set null
);
create index removed_author on moderation.removed (author_id, removed_at);

create table public.chat_reports (
  message_id bigint not null references public.chat_messages(id) on delete cascade,
  reporter   uuid not null default auth.uid() references public.members(user_id) on delete cascade,
  reason     text not null check (reason in ('hate', 'bullying', 'sexual', 'other')),
  created_at timestamptz not null default now(),
  primary key (message_id, reporter)
);
alter table public.chat_reports enable row level security;
alter table public.chat_reports force row level security;
revoke all on public.chat_reports from anon, authenticated;
grant select, insert on public.chat_reports to authenticated;
create policy "your reports" on public.chat_reports for select to authenticated using (reporter = auth.uid());
-- The subquery runs under the reporter's own chat policy: only messages you can read, never your own.
create policy "report what you can read" on public.chat_reports for insert to authenticated
  with check (reporter = auth.uid()
              and exists (select 1 from public.chat_messages m where m.id = message_id and m.author_id <> auth.uid()));

create or replace function moderation.hold_on_report()
returns trigger
language plpgsql
security definer
set search_path = public, moderation, notify
as $$
declare
  msg public.chat_messages;
  pl public.pools;
  n int;
begin
  select * into msg from public.chat_messages where id = new.message_id;
  if msg.hidden_at is not null or exists (select 1 from moderation.held where message_id = msg.id and decided = 'kept') then
    return null;
  end if;
  select * into pl from public.pools where id = msg.pool_id;
  select count(*) into n from public.chat_reports where message_id = msg.id;
  if n < (case when pl.school_emis is not null then 1 else 2 end) then return null; end if;

  insert into moderation.held (message_id, body, image_path) values (msg.id, msg.body, msg.image_path)
  on conflict (message_id) do update set body = excluded.body, image_path = excluded.image_path,
    held_at = now(), decided = null, decided_at = null, decided_by = null;
  update public.chat_messages set body = '', image_path = null, hidden_at = now() where id = msg.id;

  -- Admins hear about it straight away. A report never fails because of this.
  begin
    insert into notify.push_outbox (user_id, title, body, url, tag)
    select m.user_id, 'Message held in ' || pl.name, 'Reported ' || n || ' time' || case when n > 1 then 's' else '' end || '. Tap to review.',
           notify.app_link('admin/moderation/'), 'moderation'
    from public.members m
    where m.is_admin and exists (select 1 from public.push_subscriptions s where s.user_id = m.user_id);
    perform notify.kick_push();
  exception when others then
    raise warning 'moderation push skipped: %', sqlerrm;
  end;
  return null;
end $$;
create trigger chat_reports_hold after insert on public.chat_reports
  for each row execute function moderation.hold_on_report();

-- A held photo is out of reach for the pool too; admins can see any chat
-- photo to judge it, and delete one they remove.
create or replace function public.photo_held(p_name text)
returns boolean
language sql stable
security definer
set search_path = public, moderation
as $$
  select exists (select 1 from moderation.held where image_path = p_name and decided is distinct from 'kept')
$$;
revoke execute on function public.photo_held(text) from anon, public;
grant execute on function public.photo_held(text) to authenticated;

drop policy "pool members see photos" on storage.objects;
create policy "pool members see photos" on storage.objects for select to authenticated
  using (bucket_id = 'chat-photos' and public.is_pool_member(public.photo_pool(name)) and not public.photo_held(name));
create policy "admins see chat photos" on storage.objects for select to authenticated
  using (bucket_id = 'chat-photos' and exists (select 1 from public.members where user_id = auth.uid() and is_admin));
create policy "admins remove chat photos" on storage.objects for delete to authenticated
  using (bucket_id = 'chat-photos' and exists (select 1 from public.members where user_id = auth.uid() and is_admin));

-- Blocks -----------------------------------------------------------------

create table public.member_blocks (
  blocker    uuid not null default auth.uid() references public.members(user_id) on delete cascade,
  blocked    uuid not null references public.members(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
alter table public.member_blocks enable row level security;
alter table public.member_blocks force row level security;
revoke all on public.member_blocks from anon, authenticated;
grant select, insert, delete on public.member_blocks to authenticated;
create policy "your blocks" on public.member_blocks for select to authenticated using (blocker = auth.uid());
create policy "block as yourself" on public.member_blocks for insert to authenticated
  with check (blocker = auth.uid() and public.is_member());
create policy "unblock yours" on public.member_blocks for delete to authenticated using (blocker = auth.uid());

-- You don't see messages from people you've blocked.
drop policy "pool reads" on public.chat_messages;
create policy "pool reads" on public.chat_messages for select to authenticated
  using (public.can_read_chat(pool_id, created_at)
         and not exists (select 1 from public.member_blocks b where b.blocker = auth.uid() and b.blocked = author_id));

-- And their tags don't buzz your phone.
create or replace function notify.queue_mention()
returns trigger
language plpgsql
security definer
set search_path = public, notify
as $$
declare
  msg public.chat_messages;
  text_ text;
begin
  begin
    select * into msg from public.chat_messages where id = new.message_id;
    if msg.author_id = new.user_id then return null; end if;
    if exists (select 1 from public.member_blocks where blocker = new.user_id and blocked = msg.author_id) then
      return null;
    end if;
    if not exists (select 1 from public.members where user_id = new.user_id and push_mentions)
       or not exists (select 1 from public.push_subscriptions where user_id = new.user_id) then
      return null;
    end if;
    text_ := notify.plain_chat(msg.body);
    if text_ = '' then text_ := 'Sent a photo'; end if;
    insert into notify.push_outbox (user_id, title, body, url, tag)
    select new.user_id,
           a.display_name || ' tagged you in ' || p.name,
           case when length(text_) > 140 then left(text_, 139) || '…' else text_ end,
           notify.app_link('chat/?pool=' || msg.pool_id),
           'chat-' || msg.pool_id
    from public.members a, public.pools p
    where a.user_id = msg.author_id and p.id = msg.pool_id;
    perform notify.kick_push();
  exception when others then
    raise warning 'push for mention % skipped: %', new.message_id, sqlerrm;
  end;
  return null;
end $$;

-- Your own chat ban, if any, so the app can say so before you type.
create or replace function public.my_chat_ban()
returns text
language sql stable
security definer
set search_path = public, moderation
as $$
  select 'You can''t post in chat until ' || moderation.when_text(u) || '.'
  from (select moderation.muted_until(auth.uid()) as u) x where u is not null
$$;
revoke execute on function public.my_chat_ban() from anon, public;
grant execute on function public.my_chat_ban() to authenticated;

-- Admin review --------------------------------------------------------------

create or replace function moderation.require_admin()
returns void
language plpgsql stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin_caller() then raise exception 'Admins only' using errcode = '42501'; end if;
end $$;

-- Held messages waiting for a decision, oldest first.
create or replace function public.mod_queue()
returns table (message_id bigint, pool_name text, school boolean, author_id uuid, author_name text,
               body text, image_path text, held_at timestamptz, posted_at timestamptz,
               reports int, reasons text, author_removed int, author_caught int)
language plpgsql stable
security definer
set search_path = public, moderation
as $$
begin
  perform moderation.require_admin();
  return query
  select h.message_id, p.name, p.school_emis is not null, m.author_id, a.display_name,
         h.body, h.image_path, h.held_at, m.created_at,
         (select count(*)::int from public.chat_reports r where r.message_id = h.message_id),
         (select string_agg(distinct r.reason, ', ') from public.chat_reports r where r.message_id = h.message_id),
         (select count(*)::int from moderation.removed x where x.author_id = m.author_id and x.removed_at > now() - interval '30 days'),
         (select count(*)::int from moderation.caught c where c.user_id = m.author_id and c.created_at > now() - interval '30 days')
  from moderation.held h
  join public.chat_messages m on m.id = h.message_id
  join public.pools p on p.id = m.pool_id
  left join public.members a on a.user_id = m.author_id
  where h.decided is null
  order by h.held_at;
end $$;

-- keep: put it back for everyone (and don't hold it again).
-- remove: delete it; a second removal in 30 days means a week without chat.
-- ban: delete it and bar the author from chat until an admin lifts it.
create or replace function public.mod_decide(p_message bigint, p_action text)
returns text
language plpgsql
security definer
set search_path = public, moderation
as $$
declare
  h moderation.held;
  msg public.chat_messages;
  why text;
  until timestamptz;
begin
  perform moderation.require_admin();
  select * into h from moderation.held where message_id = p_message and decided is null;
  select * into msg from public.chat_messages where id = p_message;
  if h.message_id is null or msg.id is null then return 'Already decided'; end if;
  if p_action = 'keep' then
    update public.chat_messages set body = h.body, image_path = h.image_path, hidden_at = null where id = p_message;
    update moderation.held set decided = 'kept', decided_at = now(), decided_by = auth.uid() where message_id = p_message;
    return 'Kept';
  elsif p_action in ('remove', 'ban') then
    select coalesce(string_agg(distinct reason, ', '), '') into why from public.chat_reports where message_id = p_message;
    insert into moderation.removed (author_id, pool_id, body, reasons, removed_by)
    values (msg.author_id, msg.pool_id, h.body || coalesce(' [photo]' || nullif(h.image_path, '') , ''), why, auth.uid());
    delete from public.chat_messages where id = p_message;
    if p_action = 'ban' then
      insert into moderation.mutes (user_id, until, reason) values (msg.author_id, 'infinity', 'Banned by an admin');
      return 'Removed, and banned from chat';
    end if;
    if (select count(*) from moderation.removed where author_id = msg.author_id and removed_at > now() - interval '30 days') >= 2 then
      until := moderation.mute(msg.author_id, 'Two messages removed in 30 days', interval '7 days');
      return 'Removed. No chat for them until ' || moderation.when_text(until);
    end if;
    return 'Removed';
  end if;
  raise exception 'Unknown action %', p_action;
end $$;

-- Recent refused messages, newest first.
create or replace function public.mod_caught(p_limit int default 50)
returns table (id bigint, user_id uuid, author_name text, place text, pool_name text, body text, category text, created_at timestamptz)
language plpgsql stable
security definer
set search_path = public, moderation
as $$
begin
  perform moderation.require_admin();
  return query
  select c.id, c.user_id, m.display_name, c.place, p.name, c.body, c.category, c.created_at
  from moderation.caught c
  left join public.members m on m.user_id = c.user_id
  left join public.pools p on p.id = c.pool_id
  order by c.id desc
  limit least(p_limit, 200);
end $$;

create or replace function public.mod_bans()
returns table (user_id uuid, name text, until timestamptz, reason text)
language plpgsql stable
security definer
set search_path = public, moderation
as $$
begin
  perform moderation.require_admin();
  return query
  select distinct on (x.user_id) x.user_id, m.display_name, x.until, x.reason
  from moderation.mutes x join public.members m on m.user_id = x.user_id
  where x.lifted_at is null and x.until > now()
  order by x.user_id, x.until desc;
end $$;

create or replace function public.mod_lift(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, moderation
as $$
begin
  perform moderation.require_admin();
  update moderation.mutes set lifted_at = now() where user_id = p_user and lifted_at is null and until > now();
end $$;

-- Clears a profile picture, for when the picture is the problem.
create or replace function public.mod_clear_avatar(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, moderation
as $$
begin
  perform moderation.require_admin();
  update public.members set avatar_path = null where user_id = p_user;
end $$;

create or replace function public.mod_terms()
returns table (term text, category text, whole boolean, added_at timestamptz)
language plpgsql stable
security definer
set search_path = public, moderation
as $$
begin
  perform moderation.require_admin();
  return query select t.term, t.category, t.whole, t.added_at from moderation.terms t order by t.category, t.term;
end $$;

create or replace function public.mod_add_term(p_term text, p_category text, p_whole boolean default true)
returns void
language plpgsql
security definer
set search_path = public, moderation
as $$
begin
  perform moderation.require_admin();
  insert into moderation.terms (term, category, whole, added_by)
  values (lower(btrim(p_term)), p_category, p_whole, auth.uid())
  on conflict (term) do update set category = excluded.category, whole = excluded.whole;
end $$;

create or replace function public.mod_remove_term(p_term text)
returns void
language plpgsql
security definer
set search_path = public, moderation
as $$
begin
  perform moderation.require_admin();
  delete from moderation.terms where term = lower(btrim(p_term));
end $$;

-- What the filter would make of a text, for trying a word before adding it.
create or replace function public.mod_try(p_text text)
returns text
language plpgsql stable
security definer
set search_path = public, moderation
as $$
begin
  perform moderation.require_admin();
  return moderation.verdict(p_text);
end $$;

-- How many held messages wait, for the admin card on the profile page.
create or replace function public.mod_waiting()
returns int
language plpgsql stable
security definer
set search_path = public, moderation
as $$
begin
  perform moderation.require_admin();
  return (select count(*) from moderation.held h join public.chat_messages m on m.id = h.message_id where h.decided is null);
end $$;

do $$
declare f text;
begin
  foreach f in array array['mod_queue()', 'mod_decide(bigint, text)', 'mod_caught(int)', 'mod_bans()', 'mod_lift(uuid)',
                           'mod_clear_avatar(uuid)', 'mod_terms()', 'mod_add_term(text, text, boolean)',
                           'mod_remove_term(text)', 'mod_try(text)', 'mod_waiting()'] loop
    execute format('revoke execute on function public.%s from anon, public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
