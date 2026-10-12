-- Pin and mute league chats. Each player's own choice, kept on the server so
-- it follows them to every device. Muting stops that league's chat pushes and
-- greys its unread count; the chat itself is never hidden.

create table if not exists public.chat_prefs (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  pool_id bigint not null references public.pools (id) on delete cascade,
  pinned_at timestamptz,
  muted boolean not null default false,
  primary key (user_id, pool_id)
);
alter table public.chat_prefs enable row level security;

create policy "own chat prefs read" on public.chat_prefs for select to authenticated
  using (user_id = auth.uid());
create policy "own chat prefs add" on public.chat_prefs for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.pool_members m where m.pool_id = chat_prefs.pool_id and m.user_id = auth.uid()));
create policy "own chat prefs change" on public.chat_prefs for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Whole-table grants (column grants caused two "Permission denied" bugs before).
revoke all on public.chat_prefs from anon, public;
grant select, insert, update on public.chat_prefs to authenticated;

-- The unread counts say whether you muted the league, so the Chat tab's badge can leave it out.
create or replace view public.chat_unread with (security_invoker = true) as
 select p.id as pool_id,
    count(c.id) filter (where c.author_id <> auth.uid()) as unread,
    count(t.message_id) as tagged,
    coalesce(bool_or(cp.muted), false) as muted
   from public.pools p
     left join public.chat_reads r on r.pool_id = p.id and r.user_id = auth.uid()
     left join public.chat_messages c on c.pool_id = p.id and c.id > coalesce(r.last_read_id, 0::bigint)
     left join public.chat_mentions t on t.message_id = c.id and t.user_id = auth.uid()
     left join public.chat_prefs cp on cp.pool_id = p.id and cp.user_id = auth.uid()
  group by p.id;

-- A muted league sends no chat pushes (tags and replies). Every chat push is tagged 'chat-<pool>'.
create or replace function notify.skip_muted_chat()
returns trigger
language plpgsql
security definer
set search_path = public, notify
as $$
begin
  if new.tag ~ '^chat-[0-9]+$' and exists (
       select 1 from public.chat_prefs
       where user_id = new.user_id and pool_id = substring(new.tag from 6)::bigint and muted) then
    return null;
  end if;
  return new;
end $$;
drop trigger if exists push_outbox_skip_muted on notify.push_outbox;
create trigger push_outbox_skip_muted before insert on notify.push_outbox
  for each row execute function notify.skip_muted_chat();
