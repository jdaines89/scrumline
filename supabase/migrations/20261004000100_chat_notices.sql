-- League announcements in chat: when a round prize is won, the league hears about it.
-- Kept apart from chat_messages, which always has a member as author and goes through moderation.
create table if not exists public.chat_notices (
  id         bigint generated always as identity primary key,
  pool_id    bigint  not null references public.pools(id) on delete cascade,
  kind       text    not null check (kind in ('prize_won')),
  round      integer not null,
  winners    uuid[]  not null,
  prize      text    not null,
  sponsor    text,
  created_at timestamptz not null default now(),
  unique (pool_id, kind, round)
);

alter table public.chat_notices enable row level security;
revoke all on public.chat_notices from anon;
grant select on public.chat_notices to authenticated;
create policy "pool reads notices" on public.chat_notices for select to authenticated
  using (public.can_read_chat(pool_id, created_at));

-- Posts one notice per won round prize; safe to run again (the unique key skips repeats).
create or replace function public.post_prize_notices()
returns integer
language plpgsql security definer
set search_path = public
as $$
declare n integer;
begin
  insert into public.chat_notices (pool_id, kind, round, winners, prize, sponsor)
  select rp.pool_id, 'prize_won', rp.round, o.winners, rp.prize, rp.sponsor
  from public.round_prizes rp
  cross join lateral public.prize_outcome(rp.pool_id, rp.round) o
  where o.complete and cardinality(o.winners) > 0
    and public.pool_has_chat(rp.pool_id)
    and not exists (select 1 from public.chat_notices c
                    where c.pool_id = rp.pool_id and c.kind = 'prize_won' and c.round = rp.round)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.post_prize_notices() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.chat_notices;
  end if;
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    -- Results land every 15 minutes; announce shortly after.
    perform cron.schedule('prize-notices', '7-59/15 * * * *', 'select public.post_prize_notices()');
  end if;
end $$;
