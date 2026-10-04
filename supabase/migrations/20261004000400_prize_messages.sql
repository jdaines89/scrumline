-- A private thread for handing over a round prize: only the winner(s) and the member
-- who offered it can read or write it. Keeps sizes, addresses and pickup times out of the league chat.
create table if not exists public.prize_messages (
  id         bigint generated always as identity primary key,
  pool_id    bigint  not null,
  round      integer not null,
  author_id  uuid    not null default auth.uid() references public.members(user_id) on delete cascade,
  body       text    not null check (length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  foreign key (pool_id, round) references public.round_prizes (pool_id, round) on delete cascade
);
create index if not exists prize_messages_thread on public.prize_messages (pool_id, round, id);

-- Who is in a prize's thread: its winners, once the round is decided, and whoever offered it.
create or replace function public.prize_party(p_pool bigint, p_round integer)
returns uuid[]
language sql stable security definer
set search_path = public
as $$
  select array_append(coalesce(o.winners, '{}'), rp.offered_by)
  from public.round_prizes rp
  cross join lateral public.prize_outcome(rp.pool_id, rp.round) o
  where rp.pool_id = p_pool and rp.round = p_round and o.complete and cardinality(o.winners) > 0
$$;
revoke all on function public.prize_party(bigint, integer) from public, anon;
grant execute on function public.prize_party(bigint, integer) to authenticated;

alter table public.prize_messages enable row level security;
revoke all on public.prize_messages from anon;
grant select, insert on public.prize_messages to authenticated;
create policy "prize party reads" on public.prize_messages for select to authenticated
  using (auth.uid() = any (public.prize_party(pool_id, round)));
-- Open until a month after the prize was due, so a late hand-over can still be sorted out.
create policy "prize party writes" on public.prize_messages for insert to authenticated
  with check (author_id = auth.uid()
              and auth.uid() = any (public.prize_party(pool_id, round))
              and coalesce((select o.due_at from public.prize_outcome(pool_id, round) o), now()) > now() - interval '30 days');

-- Same word filter and mutes as the league chat.
create trigger prize_messages_moderate before insert on public.prize_messages
  for each row execute function moderation.check_chat();

-- A phone alert to the others in the thread.
create or replace function notify.prize_message_push()
returns trigger
language plpgsql security definer
set search_path = public, notify
as $$
begin
  insert into notify.push_outbox (user_id, title, body, url, tag)
  select u, a.display_name || ' · round ' || new.round || ' prize',
         case when length(new.body) > 140 then left(new.body, 139) || '…' else new.body end,
         notify.app_link('leaderboard/?pool=' || new.pool_id || '&prize=' || new.round),
         'prize-msg-' || new.pool_id || '-' || new.round
  from unnest(public.prize_party(new.pool_id, new.round)) u, public.members a
  where a.user_id = new.author_id and u <> new.author_id
    and exists (select 1 from public.push_subscriptions s where s.user_id = u);
  return null;
end $$;
create trigger prize_messages_push after insert on public.prize_messages
  for each row execute function notify.prize_message_push();

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.prize_messages;
  end if;
end $$;
