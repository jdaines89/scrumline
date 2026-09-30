-- Tournament sponsors: one business presents a whole tournament ("URC
-- 2026-27 presented by ..."), and one business can take each round of it
-- ("Round 2 sponsored by ..."). Both show to every player in the tournament,
-- in every pool.
--
-- Because one cheap deal would tie up the tournament's best slot, nothing
-- goes on air by itself:
--   * each slot has a reserve (a floor price), set per tournament by an admin;
--     below it an application isn't accepted at all;
--   * a business applies with its offer; several can apply for the same slot,
--     and none sees another's offer;
--   * an admin approves one (or declines), the business pays the Foundation,
--     and the admin marks it paid, which puts it live.
-- The money is split like every other sponsor deal (20% players' schools,
-- 20% no-fee partner schools, 20% prizes, 40% Scrumline), fixed on approval.

create table public.tournament_reserves (
  season_id   text primary key references public.seasons(id) on delete cascade,
  title_minor bigint not null check (title_minor >= 100000),
  round_minor bigint not null check (round_minor >= 10000),
  updated_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now()
);
revoke all on public.tournament_reserves from anon, authenticated;

-- Defaults when an admin hasn't set a tournament's reserve: R25,000 for the
-- whole tournament, R2,500 for a round.
create or replace function public.tournament_reserve(p_season text, p_round int)
returns bigint
language sql stable security definer
set search_path = public
as $$
  select case when p_round is null then coalesce((select title_minor from public.tournament_reserves where season_id = p_season), 2500000)
              else coalesce((select round_minor from public.tournament_reserves where season_id = p_season), 250000) end
$$;

create table public.tournament_sponsors (
  id           bigint generated always as identity primary key,
  season_id    text   not null references public.seasons(id) on delete cascade,
  round        int    check (round > 0),                 -- null: the whole tournament
  sponsor_id   bigint not null references public.sponsors(id),
  amount_minor bigint not null check (amount_minor > 0),
  currency     text   not null default 'ZAR' check (currency ~ '^[A-Z]{3}$'),
  offer        text   check (length(btrim(offer)) between 1 and 80),
  link         text   check (link ~* '^https://[^\s]+$' and length(link) <= 200),
  note         text   check (length(note) <= 280),        -- to the admin, never shown to players
  status       text   not null default 'applied'
               check (status in ('applied', 'approved', 'live', 'declined', 'withdrawn', 'lapsed')),
  reply        text   check (length(reply) <= 280),       -- the admin's reason, shown to the business
  own_school_minor     bigint,
  partner_school_minor bigint,
  prize_minor          bigint,
  scrumline_minor      bigint,
  applied_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  reviewed_by  uuid references auth.users(id) on delete set null,
  reviewed_at  timestamptz,
  pay_by       timestamptz,
  paid_at      timestamptz
);
revoke all on public.tournament_sponsors from anon, authenticated;
-- One sponsor per slot once approved; one open application per business per slot.
create unique index tournament_sponsors_one_per_slot on public.tournament_sponsors (season_id, coalesce(round, 0))
  where status in ('approved', 'live');
create unique index tournament_sponsors_one_application on public.tournament_sponsors (season_id, coalesce(round, 0), sponsor_id)
  where status = 'applied';

-- Results: once a day per player, taps every time.
create table public.tournament_sponsor_sightings (
  tsponsor_id bigint not null references public.tournament_sponsors(id) on delete cascade,
  user_id     uuid   not null references public.members(user_id) on delete cascade,
  day         date   not null default (now() at time zone 'Africa/Johannesburg')::date,
  primary key (tsponsor_id, day, user_id)
);
create table public.tournament_sponsor_daily (
  tsponsor_id bigint not null references public.tournament_sponsors(id) on delete cascade,
  day         date   not null,
  seen        int not null default 0,
  taps        int not null default 0,
  primary key (tsponsor_id, day)
);
revoke all on public.tournament_sponsor_sightings, public.tournament_sponsor_daily from anon, authenticated;

-- Whether a slot can still be sold: the tournament is live (not a replay),
-- and a round slot's round hasn't kicked off; the whole tournament can be
-- sold until its last match has started.
create or replace function public.tournament_slot_open(p_season text, p_round int)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.seasons where id = p_season and not is_replay)
     and case when p_round is null
              then exists (select 1 from public.matches where season = p_season and kickoff_at > now())
              else exists (select 1 from public.matches where season = p_season and round = p_round)
                   and not exists (select 1 from public.matches where season = p_season and round = p_round and kickoff_at <= now())
         end
$$;

-- The slots a business can apply for: the whole tournament, then every round
-- still to start. Shows the reserve and whether someone already has it (by
-- name only once it's live).
create or replace function public.tournament_slots(p_season text)
returns table (round int, first_kickoff timestamptz, reserve_minor bigint, taken boolean, taken_by text, open boolean)
language sql stable security definer
set search_path = public
as $$
  with slots as (
    select null::int as round, min(kickoff_at) as first_kickoff from public.matches where season = p_season
    union all
    select m.round, min(m.kickoff_at) from public.matches m where m.season = p_season group by m.round
  )
  select s.round, s.first_kickoff, public.tournament_reserve(p_season, s.round),
         t.id is not null, case when t.status = 'live' then sp.name end,
         public.tournament_slot_open(p_season, s.round) and t.id is null
  from slots s
  left join public.tournament_sponsors t on t.season_id = p_season and t.round is not distinct from s.round
                                        and t.status in ('approved', 'live')
  left join public.sponsors sp on sp.id = t.sponsor_id
  where (public.is_member() or public.is_business())
    and exists (select 1 from public.seasons where id = p_season and not is_replay)
    and (s.round is null or public.tournament_slot_open(p_season, s.round) or t.status = 'live')
  order by s.round nulls first
$$;

create or replace function public.apply_tournament_sponsor(p_season text, p_round int, p_sponsor bigint,
                                                           p_amount_minor bigint, p_offer text, p_link text, p_note text)
returns bigint
language plpgsql security definer
set search_path = public
as $$
declare
  s public.sponsors;
  reserve bigint := public.tournament_reserve(p_season, p_round);
  new_id bigint;
begin
  select * into s from public.sponsors where id = p_sponsor;
  if s.id is null or s.blocked or not exists (select 1 from public.sponsor_managers where sponsor_id = p_sponsor and user_id = auth.uid()) then
    raise exception 'Apply from a business you run' using errcode = '42501';
  end if;
  if not public.tournament_slot_open(p_season, p_round) then
    raise exception 'That slot is closed' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.tournament_sponsors where season_id = p_season and round is not distinct from p_round
             and status in ('approved', 'live')) then
    raise exception 'That slot is already taken' using errcode = 'P0001';
  end if;
  if p_amount_minor is null or p_amount_minor < reserve then
    raise exception 'The minimum for this slot is R%', to_char(reserve / 100, 'FM999G999G999') using errcode = 'P0001';
  end if;
  if not public.sponsor_text_ok(p_offer) or not public.sponsor_text_ok(p_note) then
    raise exception 'Some of those words can''t be shown to players. Please reword it.' using errcode = '22023';
  end if;
  insert into public.tournament_sponsors (season_id, round, sponsor_id, amount_minor, currency, offer, link, note, applied_by)
  values (p_season, p_round, p_sponsor, p_amount_minor,
          (select currency from public.countries where code = s.country),
          nullif(btrim(coalesce(p_offer, '')), ''), nullif(btrim(coalesce(p_link, '')), ''),
          nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into new_id;
  return new_id;
exception when unique_violation then
  raise exception 'Your business has already applied for that slot' using errcode = 'P0001';
end $$;

-- A business can take back an application, or an approval it hasn't paid for.
create or replace function public.withdraw_tournament_sponsor(p_id bigint)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  update public.tournament_sponsors t set status = 'withdrawn'
  where t.id = p_id and t.status in ('applied', 'approved')
    and exists (select 1 from public.sponsor_managers m where m.sponsor_id = t.sponsor_id and m.user_id = auth.uid());
  if not found then raise exception 'Nothing to withdraw' using errcode = 'P0001'; end if;
end $$;

-- A business's own applications, with how many players saw it once live.
create or replace function public.my_tournament_sponsors()
returns table (id bigint, season_id text, season_name text, round int, sponsor text, amount_minor bigint, currency text,
               offer text, link text, status text, reply text, pay_by timestamptz, created_at timestamptz,
               players_seen int, taps int)
language sql stable security definer
set search_path = public
as $$
  select t.id, t.season_id, se.name, t.round, s.name, t.amount_minor, t.currency, t.offer, t.link, t.status, t.reply,
         t.pay_by, t.created_at,
         (select count(distinct v.user_id)::int from public.tournament_sponsor_sightings v where v.tsponsor_id = t.id),
         (select coalesce(sum(d.taps), 0)::int from public.tournament_sponsor_daily d where d.tsponsor_id = t.id)
  from public.tournament_sponsors t
  join public.sponsors s on s.id = t.sponsor_id
  join public.seasons se on se.id = t.season_id
  where exists (select 1 from public.sponsor_managers m where m.sponsor_id = t.sponsor_id and m.user_id = auth.uid())
  order by t.created_at desc
$$;

-- What players see: this tournament's live sponsors.
create or replace function public.season_sponsors(p_season text)
returns table (id bigint, round int, display_name text, logo_path text, offer text, link text, about text, website text)
language sql stable security definer
set search_path = public
as $$
  select t.id, t.round, s.name, s.logo_path, t.offer, t.link, s.about, s.website
  from public.tournament_sponsors t
  join public.sponsors s on s.id = t.sponsor_id and not s.blocked
  where t.season_id = p_season and t.status = 'live' and public.is_member()
$$;

create or replace function public.tournament_sponsor_event(p_id bigint, p_kind text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Africa/Johannesburg')::date;
  fresh int;
begin
  if p_kind not in ('seen', 'tap') then raise exception 'Unknown event' using errcode = '22023'; end if;
  if not public.is_member() or not exists (select 1 from public.tournament_sponsors where id = p_id and status = 'live') then return; end if;
  if p_kind = 'seen' then
    insert into public.tournament_sponsor_sightings (tsponsor_id, user_id, day) values (p_id, auth.uid(), today) on conflict do nothing;
    get diagnostics fresh = row_count;
    if fresh = 0 then return; end if;
  end if;
  insert into public.tournament_sponsor_daily (tsponsor_id, day, seen, taps)
  values (p_id, today, (p_kind = 'seen')::int, (p_kind = 'tap')::int)
  on conflict (tsponsor_id, day) do update
    set seen = public.tournament_sponsor_daily.seen + excluded.seen,
        taps = public.tournament_sponsor_daily.taps + excluded.taps;
end $$;

-- Admin: every application, newest first, with the reserve beside it.
create or replace function public.admin_tournament_sponsors()
returns table (id bigint, season_id text, season_name text, round int, sponsor_id bigint, sponsor text, category text,
               email text, amount_minor bigint, reserve_minor bigint, currency text, offer text, link text, note text,
               status text, reply text, pay_by timestamptz, created_at timestamptz, rivals int)
language sql stable security definer
set search_path = public
as $$
  select t.id, t.season_id, se.name, t.round, s.id, s.name, s.category, s.email, t.amount_minor,
         public.tournament_reserve(t.season_id, t.round), t.currency, t.offer, t.link, t.note, t.status, t.reply,
         t.pay_by, t.created_at,
         (select count(*)::int from public.tournament_sponsors o
          where o.season_id = t.season_id and o.round is not distinct from t.round and o.id <> t.id and o.status = 'applied')
  from public.tournament_sponsors t
  join public.sponsors s on s.id = t.sponsor_id
  join public.seasons se on se.id = t.season_id
  where public.is_admin_caller()
  order by (t.status = 'applied') desc, t.created_at desc
$$;

-- Admin decisions. approve: the slot is held for this business, who has 7
-- days to pay (or until the round starts, if sooner). paid: it goes live.
-- decline / lapse (approved but never paid) free the slot.
create or replace function public.admin_decide_tournament_sponsor(p_id bigint, p_decision text, p_reply text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  t public.tournament_sponsors;
  part bigint;
  starts timestamptz;
begin
  if not public.is_admin_caller() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into t from public.tournament_sponsors where id = p_id for update;
  if t.id is null then raise exception 'No such application' using errcode = 'P0001'; end if;
  if p_decision = 'approve' then
    if t.status <> 'applied' then raise exception 'Only an application can be approved' using errcode = 'P0001'; end if;
    if not public.tournament_slot_open(t.season_id, t.round) then raise exception 'That slot has closed' using errcode = 'P0001'; end if;
    if t.amount_minor < public.tournament_reserve(t.season_id, t.round) then
      raise exception 'That offer is under the reserve' using errcode = 'P0001';
    end if;
    select min(kickoff_at) into starts from public.matches where season = t.season_id and round = t.round;
    part := t.amount_minor * 20 / 100;
    update public.tournament_sponsors
    set status = 'approved', reply = nullif(btrim(coalesce(p_reply, '')), ''), reviewed_by = auth.uid(), reviewed_at = now(),
        pay_by = least(now() + interval '7 days', coalesce(starts, 'infinity')),
        own_school_minor = part, partner_school_minor = part, prize_minor = part, scrumline_minor = t.amount_minor - 3 * part
    where id = p_id;
  elsif p_decision = 'decline' then
    if t.status <> 'applied' then raise exception 'Only an application can be declined' using errcode = 'P0001'; end if;
    update public.tournament_sponsors
    set status = 'declined', reply = nullif(btrim(coalesce(p_reply, '')), ''), reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_id;
  elsif p_decision = 'paid' then
    if t.status <> 'approved' then raise exception 'Only an approved sponsor can be marked paid' using errcode = 'P0001'; end if;
    update public.tournament_sponsors set status = 'live', paid_at = now() where id = p_id;
  elsif p_decision = 'lapse' then
    if t.status <> 'approved' then raise exception 'Only an unpaid approval can lapse' using errcode = 'P0001'; end if;
    update public.tournament_sponsors set status = 'lapsed', reply = coalesce(nullif(btrim(coalesce(p_reply, '')), ''), reply) where id = p_id;
  else
    raise exception 'Unknown decision' using errcode = '22023';
  end if;
exception when unique_violation then
  raise exception 'Another business already holds that slot' using errcode = 'P0001';
end $$;

create or replace function public.admin_set_tournament_reserve(p_season text, p_title_minor bigint, p_round_minor bigint)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin_caller() then raise exception 'Admins only' using errcode = '42501'; end if;
  insert into public.tournament_reserves (season_id, title_minor, round_minor, updated_by)
  values (p_season, p_title_minor, p_round_minor, auth.uid())
  on conflict (season_id) do update set title_minor = excluded.title_minor, round_minor = excluded.round_minor,
                                        updated_by = excluded.updated_by, updated_at = now();
end $$;

revoke execute on function public.tournament_reserve(text, int), public.tournament_slot_open(text, int),
  public.tournament_slots(text), public.apply_tournament_sponsor(text, int, bigint, bigint, text, text, text),
  public.withdraw_tournament_sponsor(bigint), public.my_tournament_sponsors(), public.season_sponsors(text),
  public.tournament_sponsor_event(bigint, text), public.admin_tournament_sponsors(),
  public.admin_decide_tournament_sponsor(bigint, text, text), public.admin_set_tournament_reserve(text, bigint, bigint)
  from public, anon;
grant execute on function public.tournament_slots(text), public.apply_tournament_sponsor(text, int, bigint, bigint, text, text, text),
  public.withdraw_tournament_sponsor(bigint), public.my_tournament_sponsors(), public.season_sponsors(text),
  public.tournament_sponsor_event(bigint, text), public.admin_tournament_sponsors(),
  public.admin_decide_tournament_sponsor(bigint, text, text), public.admin_set_tournament_reserve(text, bigint, bigint)
  to authenticated;
