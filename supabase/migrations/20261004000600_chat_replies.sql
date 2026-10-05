-- Reply to a message, like WhatsApp: the reply carries the id of the message it answers,
-- the chat shows that message quoted above it, and its author is told.
alter table public.chat_messages add column if not exists reply_to bigint references public.chat_messages(id) on delete set null;

-- A reply can only point at a message in the same pool.
create or replace function public.chat_check_reply()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.reply_to is not null
     and not exists (select 1 from public.chat_messages r where r.id = new.reply_to and r.pool_id = new.pool_id) then
    new.reply_to := null;
  end if;
  return new;
end $$;
drop trigger if exists chat_messages_reply on public.chat_messages;
create trigger chat_messages_reply before insert on public.chat_messages
  for each row execute function public.chat_check_reply();

-- The author of the message being answered counts as tagged: the @ on the Chat tab and a phone alert.
create or replace function public.chat_extract_mentions()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.chat_mentions (message_id, user_id)
  select distinct new.id, pm.user_id
  from (
    select t.x[1] as uid from regexp_matches(new.body, '<@([0-9a-f-]{36})>', 'g') as t(x)
    union
    select r.author_id::text from public.chat_messages r where r.id = new.reply_to and r.author_id <> new.author_id
  ) u
  join public.pool_members pm on pm.pool_id = new.pool_id and pm.user_id::text = u.uid
  on conflict do nothing;
  return new;
end;
$$;

create or replace function notify.queue_mention()
returns trigger
language plpgsql security definer
set search_path = public, notify
as $$
declare
  msg public.chat_messages;
  text_ text;
  replied boolean;
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
    replied := exists (select 1 from public.chat_messages r where r.id = msg.reply_to and r.author_id = new.user_id);
    text_ := notify.plain_chat(msg.body);
    if text_ = '' then text_ := 'Sent a photo'; end if;
    insert into notify.push_outbox (user_id, title, body, url, tag)
    select new.user_id,
           a.display_name || case when replied then ' replied to you in ' else ' tagged you in ' end || p.name,
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
