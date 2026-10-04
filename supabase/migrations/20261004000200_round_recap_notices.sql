-- The round recap posts itself to each league's chat once a round's results are final,
-- instead of members posting it by hand (which could flood the chat with copies).
alter table public.chat_notices drop constraint if exists chat_notices_kind_check;
alter table public.chat_notices add constraint chat_notices_kind_check check (kind in ('prize_won', 'round_recap'));
alter table public.chat_notices alter column prize drop not null;
alter table public.chat_notices alter column winners set default '{}';

-- One recap per league and round, for live tournaments, when at least two players scored in the round.
-- Only rounds that finished in the last three days, so switching this on never floods old rounds.
create or replace function public.post_round_recaps()
returns integer
language plpgsql security definer
set search_path = public
as $$
declare n integer;
begin
  insert into public.chat_notices (pool_id, kind, round)
  select p.id, 'round_recap', r.round
  from public.pools p
  join public.seasons s on s.id = p.season and not s.is_replay
  join lateral (
    select m.round, max(m.kickoff_at) as last_ko
    from public.matches m
    where m.season = p.season and m.round is not null
    group by m.round
    having bool_and(m.status in ('FT', 'INTR', 'POSTP')) and bool_or(m.status in ('FT', 'INTR'))
  ) r on r.last_ko > now() - interval '3 days'
  where public.pool_has_chat(p.id)
    and (select count(*) from public.pool_members pm
         join public.entries e on e.user_id = pm.user_id and e.season = p.season
         join public.entry_round_totals t on t.entry_id = e.id and t.round = r.round
         where pm.pool_id = p.id and t.matches > 0) >= 2
    and not exists (select 1 from public.chat_notices c
                    where c.pool_id = p.id and c.kind = 'round_recap' and c.round = r.round)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.post_round_recaps() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    -- Recap first, then the prize shout, so the shout lands under the recap.
    perform cron.schedule('prize-notices', '7-59/15 * * * *', 'select public.post_round_recaps(); select public.post_prize_notices();');
  end if;
end $$;
