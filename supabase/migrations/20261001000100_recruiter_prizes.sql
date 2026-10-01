-- Recruiter prizes, and invite links that keep going.
--
-- Bringing people in earned quiet credit ("brought in N", top recruiter of
-- the month) but nothing you could hold. Now a member who runs a business on
-- Scrumline can put up a prize for a pool's top recruiter of the month: a
-- shirt, a bar tab, a voucher. Still no prediction points for inviting, so
-- the game stays fair; the reward is a real thing from a named business.
--
-- The rules mirror round prizes, so a promise stays visible:
--   * one recruiter prize per pool per month (SAST), from a business the
--     offering member runs, word-checked, with optional details and photo;
--   * it can go up any time before the month ends (for this month or next),
--     and can only be withdrawn before the month starts;
--   * a new player counts for whoever's link brought them in that month,
--     once they have made calls on 3 matches that kicked off. That stops a
--     handful of empty sign-ups winning anything;
--   * the result is fixed 7 days after the month ends (so late joiners get a
--     weekend to play); ties share it; the winner marks it received;
--   * not marked received within 14 days of that shows as not delivered, and
--     the person who offered it can't offer any prize until it is.
-- Any pool can have one, school pools included: that's where recruiting
-- matters most.
--
-- And the 20-person limit on an invite link now only counts people who
-- haven't played yet. A leaked link still stops after 20 empty sign-ups, but
-- someone whose mates actually play never runs out.

-- Midnight SAST on the first of a month.
create or replace function public.sast_month_start(p_month date)
returns timestamptz
language sql immutable
set search_path = public
as $$ select (date_trunc('month', p_month)::timestamp) at time zone 'Africa/Johannesburg' $$;

-- This month, SAST, as a date on the first.
create or replace function public.sast_this_month()
returns date
language sql stable
set search_path = public
as $$ select date_trunc('month', now() at time zone 'Africa/Johannesburg')::date $$;

-- How many new players someone brought in during a window, counting only
-- those who had calls on at least 3 matches that kicked off before p_asof.
create or replace function public.recruits_between(p_user uuid, p_from timestamptz, p_to timestamptz, p_asof timestamptz)
returns int
language sql stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.invites i
  where i.invited_by = p_user and i.created_at >= p_from and i.created_at < p_to
    and (select count(*) from public.entries e
         join public.predictions p on p.entry_id = e.id
         join public.matches m on m.id = p.match_id
         where e.user_id = i.invitee_id and m.kickoff_at < p_asof) >= 3
$$;
revoke all on function public.recruits_between(uuid, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;

create table public.recruiter_prizes (
  pool_id    bigint not null references public.pools(id) on delete cascade,
  month      date   not null check (month = date_trunc('month', month)::date),
  sponsor_id bigint references public.sponsors(id) on delete set null,
  sponsor    text   not null check (length(btrim(sponsor)) between 1 and 40),
  prize      text   not null check (length(btrim(prize)) between 1 and 60),
  details    text   check (length(btrim(details)) between 1 and 280),
  image_path text,
  offered_by uuid   not null default auth.uid() references public.members(user_id),
  created_at timestamptz not null default now(),
  primary key (pool_id, month),
  constraint recruiter_prizes_image_own
    check (image_path is null or image_path ~ ('^' || sponsor_id::text || '/[A-Za-z0-9_-]{1,64}\.jpg$'))
);

create table public.recruiter_prize_receipts (
  pool_id     bigint not null,
  month       date   not null,
  user_id     uuid   not null default auth.uid() references public.members(user_id),
  received_at timestamptz not null default now(),
  primary key (pool_id, month, user_id),
  foreign key (pool_id, month) references public.recruiter_prizes (pool_id, month) on delete cascade
);

-- How a pool's recruiting month stands: who's ahead now, and once it's
-- fixed (7 days after the month ends), who won.
create or replace function public.recruiter_outcome(p_pool bigint, p_month date)
returns table (started boolean, decided boolean, decided_at timestamptz, due_at timestamptz,
               best int, leaders uuid[], winners uuid[])
language sql stable
security definer
set search_path = public
as $$
  with w as (
    select public.sast_month_start(p_month) as from_ts,
           public.sast_month_start((p_month + interval '1 month')::date) as to_ts
  ), w2 as (
    select from_ts, to_ts, to_ts + interval '7 days' as fixed_at from w
  ), counts as (
    select pm.user_id, public.recruits_between(pm.user_id, w2.from_ts, w2.to_ts, least(now(), w2.fixed_at)) as n
    from public.pool_members pm cross join w2
    where pm.pool_id = p_pool
  ), top as (
    select coalesce(max(n), 0) as best from counts
  )
  select w2.from_ts <= now(),
         w2.fixed_at <= now(),
         w2.fixed_at,
         w2.fixed_at + interval '14 days',
         top.best,
         case when top.best > 0 then (select array_agg(c.user_id order by c.user_id) from counts c where c.n = top.best) end,
         case when w2.fixed_at <= now() and top.best > 0
              then (select array_agg(c.user_id order by c.user_id) from counts c where c.n = top.best) end
  from w2 cross join top
$$;
revoke all on function public.recruiter_outcome(bigint, date) from public, anon, authenticated;

-- Has this person offered a recruiter prize that's now overdue?
create or replace function public.owes_recruiter_prize(p_user uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.recruiter_prizes rp
    cross join lateral public.recruiter_outcome(rp.pool_id, rp.month) o
    where rp.offered_by = p_user and o.decided and o.due_at < now()
      and exists (select 1 from unnest(o.winners) w
                  where not exists (select 1 from public.recruiter_prize_receipts r
                                    where r.pool_id = rp.pool_id and r.month = rp.month and r.user_id = w)))
$$;
revoke all on function public.owes_recruiter_prize(uuid) from public, anon, authenticated;

-- An overdue prize of either kind blocks offering any new one.
create or replace function public.owes_prize(p_user uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.round_prizes rp
    cross join lateral public.prize_outcome(rp.pool_id, rp.round) o
    where rp.offered_by = p_user and o.complete and o.due_at < now()
      and exists (select 1 from unnest(o.winners) w
                  where not exists (select 1 from public.prize_receipts pr
                                    where pr.pool_id = rp.pool_id and pr.round = rp.round and pr.user_id = w)))
    or public.owes_recruiter_prize(p_user)
$$;

-- Can I put up a recruiter prize in this pool, for this month, for this business?
create or replace function public.can_offer_recruiter_prize(p_pool bigint, p_month date, p_sponsor bigint)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.pools p
    join public.seasons s on s.id = p.season
    where p.id = p_pool and not s.is_replay
      and exists (select 1 from public.pool_members pm where pm.pool_id = p.id and pm.user_id = auth.uid()))
    and exists (select 1 from public.my_businesses() b where b.id = p_sponsor)
    and p_month in (public.sast_this_month(), (public.sast_this_month() + interval '1 month')::date)
    and not public.owes_prize(auth.uid())
$$;
revoke all on function public.can_offer_recruiter_prize(bigint, date, bigint) from public, anon;
grant execute on function public.can_offer_recruiter_prize(bigint, date, bigint) to authenticated;

-- Did I win this month's recruiter prize here?
create or replace function public.won_recruiter_prize(p_pool bigint, p_month date)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.recruiter_outcome(p_pool, p_month) o where auth.uid() = any (o.winners))
$$;
revoke all on function public.won_recruiter_prize(bigint, date) from public, anon;
grant execute on function public.won_recruiter_prize(bigint, date) to authenticated;

-- The pool sees the business's own name, and the words are checked.
create or replace function public.recruiter_prize_from_business()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select s.name into new.sponsor from public.sponsors s where s.id = new.sponsor_id;
  new.prize := btrim(new.prize);
  new.details := nullif(btrim(coalesce(new.details, '')), '');
  if not public.sponsor_text_ok(new.prize) or not public.sponsor_text_ok(new.details) then
    raise exception 'Some of those words can''t be shown to players. Please reword it.' using errcode = '22023';
  end if;
  return new;
end $$;
revoke execute on function public.recruiter_prize_from_business() from public, anon, authenticated;
create trigger recruiter_prize_from_business before insert on public.recruiter_prizes
  for each row execute function public.recruiter_prize_from_business();

alter table public.recruiter_prizes enable row level security;
alter table public.recruiter_prizes force row level security;
create policy "pool members see recruiter prizes" on public.recruiter_prizes for select to authenticated
  using (public.is_pool_member(pool_id));
create policy "a member's business offers a recruiter prize" on public.recruiter_prizes for insert to authenticated
  with check (offered_by = auth.uid() and sponsor_id is not null
              and public.can_offer_recruiter_prize(pool_id, month, sponsor_id));
create policy "withdrawn only before the month starts" on public.recruiter_prizes for delete to authenticated
  using (offered_by = auth.uid() and month > public.sast_this_month());

alter table public.recruiter_prize_receipts enable row level security;
alter table public.recruiter_prize_receipts force row level security;
create policy "pool members see recruiter receipts" on public.recruiter_prize_receipts for select to authenticated
  using (public.is_pool_member(pool_id));
create policy "recruiter winners mark received" on public.recruiter_prize_receipts for insert to authenticated
  with check (user_id = auth.uid() and public.won_recruiter_prize(pool_id, month));

revoke all on public.recruiter_prizes, public.recruiter_prize_receipts from anon, authenticated;
grant select, delete on public.recruiter_prizes to authenticated;
grant insert (pool_id, month, sponsor_id, sponsor, prize, details, image_path) on public.recruiter_prizes to authenticated;
grant select on public.recruiter_prize_receipts to authenticated;
grant insert (pool_id, month) on public.recruiter_prize_receipts to authenticated;

-- A pool's recruiter prizes with where each stands, for the app.
create or replace function public.pool_recruiter_prizes(p_pool bigint)
returns table (month date, sponsor text, prize text, details text, image_path text, offered_by uuid,
               status text, best int, leaders uuid[], winners uuid[], received uuid[],
               decided_at timestamptz, due_at timestamptz,
               sponsor_about text, sponsor_website text, sponsor_logo text)
language sql stable
security definer
set search_path = public
as $$
  select rp.month, rp.sponsor, rp.prize, rp.details, rp.image_path, rp.offered_by,
         case when not o.started then 'upcoming'
              when now() < public.sast_month_start((rp.month + interval '1 month')::date) then 'open'
              when not o.decided then 'counting'
              when o.winners is null then 'no winner'
              when o.winners <@ coalesce(rc.received, '{}') then 'delivered'
              when o.due_at < now() then 'not delivered'
              else 'awaiting' end,
         o.best, o.leaders, o.winners, coalesce(rc.received, '{}'), o.decided_at, o.due_at,
         s.about, s.website, s.logo_path
  from public.recruiter_prizes rp
  cross join lateral public.recruiter_outcome(rp.pool_id, rp.month) o
  left join public.sponsors s on s.id = rp.sponsor_id
  left join lateral (select array_agg(r.user_id) as received from public.recruiter_prize_receipts r
                     where r.pool_id = rp.pool_id and r.month = rp.month) rc on true
  where rp.pool_id = p_pool and public.is_pool_member(p_pool)
  order by rp.month
$$;
revoke all on function public.pool_recruiter_prizes(bigint) from public, anon;
grant execute on function public.pool_recruiter_prizes(bigint) to authenticated;

-- This month's recruiter prizes in your pools, with your own count, for
-- the invite card: the reason to send your link today.
create or replace function public.my_recruiter_prizes()
returns table (pool_id bigint, pool_name text, prize text, sponsor text, mine int, best int)
language sql stable
security definer
set search_path = public
as $$
  select rp.pool_id, p.name, rp.prize, rp.sponsor,
         public.recruits_between(auth.uid(), public.sast_month_start(rp.month),
                                 public.sast_month_start((rp.month + interval '1 month')::date), now()),
         o.best
  from public.recruiter_prizes rp
  join public.pools p on p.id = rp.pool_id
  join public.pool_members pm on pm.pool_id = rp.pool_id and pm.user_id = auth.uid()
  cross join lateral public.recruiter_outcome(rp.pool_id, rp.month) o
  where rp.month = public.sast_this_month()
  order by p.name
$$;
revoke all on function public.my_recruiter_prizes() from public, anon;
grant execute on function public.my_recruiter_prizes() to authenticated;

-- Invite links: the limit of 20 counts only people who haven't made a call yet.
create or replace function public.invites_waiting(p_user uuid)
returns int
language sql stable
security definer
set search_path = public
as $$
  select count(*)::int from public.invites i
  where i.invited_by = p_user
    and not exists (select 1 from public.entries e join public.predictions p on p.entry_id = e.id
                    where e.user_id = i.invitee_id)
$$;
revoke all on function public.invites_waiting(uuid) from public, anon, authenticated;

create or replace function public.invite_info(p_code text)
returns table (inviter text, open boolean)
language sql stable
security definer
set search_path = public
as $$
  select m.display_name, public.invites_waiting(m.user_id) < 20
  from public.invite_codes c join public.members m on m.user_id = c.user_id
  where c.code = lower(btrim(p_code))
$$;

-- Your link's code, everyone it has brought in, and how many of those
-- haven't played yet (the ones that count towards the limit).
drop function public.my_invite();
create function public.my_invite()
returns table (code text, used int, cap int, waiting int)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_member() then return; end if;
  insert into public.invite_codes (user_id, code) values (auth.uid(), public.new_invite_code())
  on conflict (user_id) do nothing;
  return query
    select c.code, (select count(*)::int from public.invites i where i.invited_by = auth.uid()), 20,
           public.invites_waiting(auth.uid())
    from public.invite_codes c where c.user_id = auth.uid();
end $$;
revoke execute on function public.my_invite() from anon, public;
grant execute on function public.my_invite() to authenticated;

create or replace function public.invite_check(p_code text, p_email text)
returns table (inviter uuid, problem text)
language plpgsql stable
security definer
set search_path = public
as $$
declare
  owner uuid;
begin
  select user_id into owner from public.invite_codes where code = lower(btrim(p_code));
  if owner is null then return query select null::uuid, 'That invite link isn''t valid any more. Ask for a new one.'; return; end if;
  if p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(p_email) > 254 then
    return query select null::uuid, 'That doesn''t look like an email address.'; return;
  end if;
  if exists (select 1 from public.members where lower(email) = lower(btrim(p_email))) then
    return query select null::uuid, 'exists'; return;
  end if;
  if public.invites_waiting(owner) >= 20 then
    return query select null::uuid, 'This invite link has 20 people who haven''t played yet, which is the limit. Ask for another one, or try again once they''ve made a call.'; return;
  end if;
  if (select count(*) from public.invites where invited_by = owner and created_at > now() - interval '1 hour') >= 10 then
    return query select null::uuid, 'This link has had a lot of sign-ups in the last hour. Try again a bit later.'; return;
  end if;
  return query select owner, null::text;
end $$;
