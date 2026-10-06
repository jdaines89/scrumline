-- Polls in league chat. A poll is a chat message (its question is the body),
-- so it sits in the chat in order, takes replies and reactions, counts as
-- unread and goes through the same moderation, with 2 to 6 answers attached.
-- Each player picks one answer and can change it; everyone in the league
-- sees the totals and who picked what, like a WhatsApp poll.
--
-- Additive only.

create table if not exists public.chat_polls (
  message_id bigint primary key references public.chat_messages(id) on delete cascade,
  options    text[] not null check (cardinality(options) between 2 and 6),
  created_at timestamptz not null default now()
);

create table if not exists public.chat_poll_votes (
  message_id bigint not null references public.chat_polls(message_id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.members(user_id) on delete cascade,
  choice     smallint not null check (choice >= 0),
  voted_at   timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.chat_polls enable row level security;
alter table public.chat_polls force row level security;
alter table public.chat_poll_votes enable row level security;
alter table public.chat_poll_votes force row level security;
revoke all on public.chat_polls from anon;
revoke all on public.chat_poll_votes from anon;
revoke insert, update, delete on public.chat_polls from authenticated;
revoke insert, update, delete on public.chat_poll_votes from authenticated;
grant select on public.chat_polls, public.chat_poll_votes to authenticated;
grant insert (message_id, options) on public.chat_polls to authenticated;
grant insert (message_id, user_id, choice) on public.chat_poll_votes to authenticated;
grant update (choice, voted_at) on public.chat_poll_votes to authenticated;

-- The subqueries run under the reader's own chat_messages policy, so a poll
-- and its votes are visible exactly where the message is.
create policy "read polls on messages you can read" on public.chat_polls for select to authenticated
  using (exists (select 1 from public.chat_messages c where c.id = message_id));
create policy "attach a poll to your own new message" on public.chat_polls for insert to authenticated
  with check (exists (select 1 from public.chat_messages c
                      where c.id = message_id and c.author_id = auth.uid() and c.created_at > now() - interval '5 minutes'));
create policy "read votes on polls you can read" on public.chat_poll_votes for select to authenticated
  using (exists (select 1 from public.chat_messages c where c.id = message_id));
create policy "vote as yourself" on public.chat_poll_votes for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.chat_messages c where c.id = message_id));
create policy "change your own vote" on public.chat_poll_votes for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Answers are tidied, must be different, fit on a phone, and pass the chat's word rules.
create or replace function moderation.check_poll()
returns trigger
language plpgsql
security definer
set search_path = public, moderation
as $$
declare
  o text;
  cat text;
  is_strict boolean := exists (select 1 from public.chat_messages c join public.pools p on p.id = c.pool_id
                            where c.id = new.message_id and p.school_emis is not null);
begin
  new.options := array(select btrim(x) from unnest(new.options) as x);
  foreach o in array new.options loop
    if o = '' then raise exception 'Every answer needs some words.' using errcode = '22023'; end if;
    if char_length(o) > 60 then raise exception 'Keep each answer to 60 characters.' using errcode = '22023'; end if;
    cat := moderation.verdict(o);
    if moderation.blocks(cat, is_strict) then raise exception '%', moderation.refusal(cat) using errcode = '22023'; end if;
  end loop;
  if (select count(distinct lower(x)) from unnest(new.options) as x) <> cardinality(new.options) then
    raise exception 'Each answer must be different.' using errcode = '22023';
  end if;
  return new;
end $$;
create or replace trigger chat_polls_moderate before insert on public.chat_polls
  for each row execute function moderation.check_poll();

-- A vote must be one of the poll's answers; changing it moves its time on.
create or replace function public.check_poll_vote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.choice >= (select cardinality(options) from public.chat_polls where message_id = new.message_id) then
    raise exception 'That isn''t one of the answers.' using errcode = '22023';
  end if;
  new.voted_at := now();
  return new;
end $$;
create or replace trigger chat_poll_votes_check before insert or update on public.chat_poll_votes
  for each row execute function public.check_poll_vote();

-- Posts the question and its answers together, as the signed-in player
-- (so every chat rule applies), and returns the message.
create or replace function public.post_poll(p_pool bigint, p_question text, p_options text[])
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare id bigint;
begin
  if char_length(btrim(coalesce(p_question, ''))) = 0 then raise exception 'Ask a question.' using errcode = '22023'; end if;
  if char_length(btrim(p_question)) > 140 then raise exception 'Keep the question to 140 characters.' using errcode = '22023'; end if;
  if cardinality(coalesce(p_options, '{}')) not between 2 and 6 then raise exception 'A poll needs 2 to 6 answers.' using errcode = '22023'; end if;
  insert into public.chat_messages (pool_id, author_id, body) values (p_pool, auth.uid(), btrim(p_question)) returning chat_messages.id into id;
  insert into public.chat_polls (message_id, options) values (id, p_options);
  return id;
end $$;
revoke execute on function public.post_poll(bigint, text, text[]) from anon, public;
grant execute on function public.post_poll(bigint, text, text[]) to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chat_polls') then
      alter publication supabase_realtime add table public.chat_polls;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chat_poll_votes') then
      alter publication supabase_realtime add table public.chat_poll_votes;
    end if;
  end if;
end $$;
