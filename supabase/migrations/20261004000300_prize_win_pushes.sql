-- When a round prize is won, tell the winner and the business that offered it straight away
-- (a phone notification for anyone who turned them on), not only through the chat card.
create or replace function public.post_prize_notices()
returns integer
language plpgsql security definer
set search_path = public
as $$
declare n integer;
begin
  with won as (
    insert into public.chat_notices (pool_id, kind, round, winners, prize, sponsor)
    select rp.pool_id, 'prize_won', rp.round, o.winners, rp.prize, rp.sponsor
    from public.round_prizes rp
    cross join lateral public.prize_outcome(rp.pool_id, rp.round) o
    where o.complete and cardinality(o.winners) > 0
      and public.pool_has_chat(rp.pool_id)
      and not exists (select 1 from public.chat_notices c
                      where c.pool_id = rp.pool_id and c.kind = 'prize_won' and c.round = rp.round)
    on conflict do nothing
    returning pool_id, round, winners, prize, sponsor
  ), winners as (
    insert into notify.push_outbox (user_id, title, body, url, tag)
    select w.uid, 'You won round ' || won.round || '''s prize 🏆',
           won.prize || coalesce(' from ' || won.sponsor, '') || '. They''ll be in touch to get it to you.',
           notify.app_link('leaderboard/?pool=' || won.pool_id), 'prize-' || won.pool_id || '-' || won.round
    from won cross join lateral unnest(won.winners) w(uid)
    where exists (select 1 from public.push_subscriptions s where s.user_id = w.uid)
  ), givers as (
    insert into notify.push_outbox (user_id, title, body, url, tag)
    select rp.offered_by,
           (select string_agg(m.display_name, ' & ') from public.members m where m.user_id = any (won.winners))
             || ' won your round ' || won.round || ' prize',
           'Get the ' || won.prize || ' to them within 14 days. They tap Received once they have it.',
           notify.app_link('sponsor/prizes/'), 'prize-give-' || won.pool_id || '-' || won.round
    from won join public.round_prizes rp on rp.pool_id = won.pool_id and rp.round = won.round
    where not (rp.offered_by = any (won.winners))
      and exists (select 1 from public.push_subscriptions s where s.user_id = rp.offered_by)
  )
  select count(*) into n from won;
  return n;
end $$;

revoke all on function public.post_prize_notices() from public, anon, authenticated;
