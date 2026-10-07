-- Stops one person flooding the chats.
--
-- Before: the word filter, reports and blocks stopped nasty messages, but
-- nothing stopped volume. Someone could paste the same advert or link into
-- every league and school chat they belong to, or fire off hundreds of
-- messages a minute (each @mention a push).
-- Now, for everyone except admins:
--   * at most 15 messages a minute and 100 an hour across all chats
--     (a 10-photo group still goes through);
--   * the same text (15+ characters) can go to at most 2 leagues an hour;
--   * links wait until a player has been in for 3 days.
-- The app asks chat_check first, which records a copy-paste or link refusal
-- as 'spam'; the third in a day takes the sender off chat for a day (a week
-- if it happens again within 30 days), like the hate rule. The insert trigger
-- enforces the same limits whatever the app does.

create index if not exists chat_messages_author on public.chat_messages (author_id, created_at desc);

-- Why this message can't go now, or null. Kinds: 'burst', 'hour', 'copy', 'link'.
create or replace function moderation.flood_kind(p_user uuid, p_pool bigint, p_body text)
returns text
language plpgsql stable
security definer
set search_path = public, moderation
as $$
declare
  txt text := lower(btrim(coalesce(p_body, '')));
begin
  if p_user is null or exists (select 1 from public.members where user_id = p_user and is_admin) then return null; end if;
  if (select count(*) from public.chat_messages where author_id = p_user and created_at > now() - interval '1 minute') >= 15 then
    return 'burst';
  end if;
  if (select count(*) from public.chat_messages where author_id = p_user and created_at > now() - interval '1 hour') >= 100 then
    return 'hour';
  end if;
  if char_length(txt) >= 15 and (select count(distinct pool_id) from public.chat_messages
       where author_id = p_user and created_at > now() - interval '1 hour'
         and pool_id is distinct from p_pool and lower(btrim(body)) = txt) >= 2 then
    return 'copy';
  end if;
  if txt ~ '(https?://|www\.|\m[a-z0-9-]{2,}\.(com|net|org|io|co|xyz|ly|me|app|link|info|biz|top|click|shop|site|online|live)(/|\M))'
     and exists (select 1 from public.members where user_id = p_user and joined_at > now() - interval '3 days') then
    return 'link';
  end if;
  return null;
end $$;
revoke execute on function moderation.flood_kind(uuid, bigint, text) from public, anon, authenticated;

create or replace function moderation.flood_text(p_kind text)
returns text
language sql immutable
as $$
  select case p_kind
    when 'burst' then 'Slow down a little. Try again in a minute.'
    when 'hour' then 'That''s a lot of messages this hour. Try again later.'
    when 'copy' then 'Not sent. You''ve already posted that in other leagues.'
    when 'link' then 'Not sent. New players can share links after their first 3 days.'
  end
$$;

-- The app's check before sending: the same rules as before, plus the flood limits.
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
  kind text;
begin
  if not public.is_pool_member(p_pool) then return 'You''re not in this league.'; end if;
  if until is not null then return 'You can''t post in chat until ' || moderation.when_text(until) || '.'; end if;
  kind := moderation.flood_kind(me, p_pool, p_body);
  if kind in ('copy', 'link') then
    insert into moderation.caught (user_id, place, pool_id, body, category)
    values (me, 'chat', p_pool, left(p_body, 1000), 'spam');
    if (select count(*) from moderation.caught
         where user_id = me and category = 'spam' and created_at > now() - interval '24 hours') >= 3 then
      until := moderation.mute(me, 'Spamming chats');
      return moderation.flood_text(kind) || ' You can''t post in chat until ' || moderation.when_text(until) || '.';
    end if;
  end if;
  if kind is not null then return moderation.flood_text(kind); end if;
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

-- Enforced on the table too, for anyone who skips the app.
create or replace function moderation.check_flood()
returns trigger
language plpgsql
security definer
set search_path = public, moderation
as $$
declare
  kind text := moderation.flood_kind(new.author_id, new.pool_id, new.body);
begin
  if kind is not null then
    raise exception '%', moderation.flood_text(kind) using errcode = '22023';
  end if;
  return new;
end $$;
create or replace trigger chat_messages_flood before insert on public.chat_messages
  for each row execute function moderation.check_flood();
