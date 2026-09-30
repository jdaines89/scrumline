-- Round prizes come from a business. Any member of a mates' pool can put one
-- up, not only the pool's creator, but only in the name of a business they
-- run on Scrumline (a sponsors row they manage, set up from Business profile).
-- The business's name is what the pool sees, so a prize always has a named
-- business and a named person behind it, and the person who offers it is the
-- one held to delivering it (owes_prize, as before).
--
-- Everything else stays: mates' pools of up to 50, live seasons only, before
-- the round's first kickoff, no edits, and the winner marks it received.

alter table public.round_prizes
  add column sponsor_id bigint references public.sponsors(id) on delete set null;

-- The businesses you run yourself. Admins can see every sponsor, but a prize
-- is offered only in the name of a business you are a manager of.
create or replace function public.my_businesses()
returns table (id bigint, name text)
language sql stable
security definer
set search_path = public
as $$
  select s.id, s.name
  from public.sponsors s
  join public.sponsor_managers sm on sm.sponsor_id = s.id and sm.user_id = auth.uid()
  where not s.blocked
  order by s.created_at
$$;
revoke execute on function public.my_businesses() from public, anon;
grant execute on function public.my_businesses() to authenticated;

drop policy "creator offers before kickoff" on public.round_prizes;
drop policy "creator withdraws before kickoff" on public.round_prizes;
drop function public.can_offer_prize(bigint, integer);

-- Can I put up a prize for this round in this pool, for this business?
create or replace function public.can_offer_prize(p_pool bigint, p_round integer, p_sponsor bigint)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.pools p
    join public.seasons s on s.id = p.season
    where p.id = p_pool and p.school_emis is null and not s.is_replay
      and exists (select 1 from public.pool_members pm where pm.pool_id = p.id and pm.user_id = auth.uid())
      and exists (select 1 from public.matches m where m.season = p.season and m.round = p_round)
      and (select count(*) from public.pool_members pm where pm.pool_id = p.id) <= 50)
    and exists (select 1 from public.my_businesses() b where b.id = p_sponsor)
    and not public.round_started(p_pool, p_round)
    and not public.owes_prize(auth.uid())
$$;
revoke execute on function public.can_offer_prize(bigint, integer, bigint) from public, anon;
grant execute on function public.can_offer_prize(bigint, integer, bigint) to authenticated;

-- The pool sees the business's own name, whatever the app sent, and the
-- prize line goes through the same word check as sponsor lines.
create or replace function public.round_prize_from_business()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select s.name into new.sponsor from public.sponsors s where s.id = new.sponsor_id;
  new.prize := btrim(new.prize);
  if not public.sponsor_text_ok(new.prize) then
    raise exception 'Some of those words can''t be shown to players. Please reword it.' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger round_prize_from_business before insert on public.round_prizes
  for each row execute function public.round_prize_from_business();

create policy "a member's business offers before kickoff" on public.round_prizes for insert to authenticated
  with check (offered_by = auth.uid() and sponsor_id is not null and public.can_offer_prize(pool_id, round, sponsor_id));
create policy "whoever offered withdraws before kickoff" on public.round_prizes for delete to authenticated
  using (offered_by = auth.uid() and not public.round_started(pool_id, round));
grant insert (sponsor_id) on public.round_prizes to authenticated;
