-- The money ledger: every rand that moves through Scrumline, in double entry,
-- append-only.
--
-- Two streams, never mixed:
--   media_fee  advertising Scrumline sells (its revenue);
--   gift       money a sponsor gives to schools, a school project or the fund,
--              recorded as passing from the sponsor to them. Scrumline is the
--              witness, not the owner;
--   prize      the prize pot share of a booking.
-- Each entry's lines balance (debits = credits) and nothing is ever edited or
-- deleted: a refund is a new entry that reverses the original.
--
-- Entries post themselves when money is marked paid (sponsor bookings,
-- tournament sponsors, project pledges) and reverse when a booking is
-- refunded. The existing tables keep working exactly as before; the ledger
-- reads them. Admins only.

create schema if not exists finance;
revoke all on schema finance from public, anon, authenticated;

create table if not exists finance.accounts (
  id         text primary key,            -- 'scrumline:revenue', 'sponsor:12', 'school:<emis>', 'project:3', 'schools:fund', 'prizes:pot'
  kind       text not null check (kind in ('scrumline', 'sponsor', 'school', 'project', 'fund', 'prize')),
  name       text not null,
  created_at timestamptz not null default now()
);

create table if not exists finance.entries (
  id           bigint generated always as identity primary key,
  posted_at    timestamptz not null default now(),
  source_table text not null,
  source_id    bigint not null,
  kind         text not null check (kind in ('paid', 'refund')),
  memo         text not null,
  reverses     bigint references finance.entries(id),
  unique (source_table, source_id, kind)
);

create table if not exists finance.lines (
  entry_id     bigint not null references finance.entries(id),
  line_no      integer not null,
  account_id   text not null references finance.accounts(id),
  stream       text not null check (stream in ('media_fee', 'gift', 'prize')),
  debit_minor  bigint not null default 0 check (debit_minor >= 0),
  credit_minor bigint not null default 0 check (credit_minor >= 0),
  currency     text not null default 'ZAR',
  primary key (entry_id, line_no),
  check ((debit_minor > 0) <> (credit_minor > 0))
);

-- Nothing in the ledger changes once written.
create or replace function finance.refuse_change() returns trigger language plpgsql as $$
begin
  raise exception 'The money ledger is append-only: add a reversing entry instead';
end $$;
create or replace trigger entries_append_only before update or delete on finance.entries
  for each row execute function finance.refuse_change();
create or replace trigger lines_append_only before update or delete on finance.lines
  for each row execute function finance.refuse_change();
-- Emptying a table outright is a privilege only the database owner has; the
-- app's roles get no rights on the finance schema at all.

-- Every entry balances, per stream and currency, checked when the transaction commits.
create or replace function finance.check_balanced() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from finance.lines where entry_id = new.entry_id
             group by stream, currency having sum(debit_minor) <> sum(credit_minor)) then
    raise exception 'Ledger entry % does not balance', new.entry_id;
  end if;
  return null;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'lines_balanced') then
    create constraint trigger lines_balanced after insert on finance.lines
      deferrable initially deferred for each row execute function finance.check_balanced();
  end if;
end $$;

create or replace function finance.account(p_id text, p_kind text, p_name text) returns text
language sql security definer set search_path = '' as $$
  insert into finance.accounts (id, kind, name) values (p_id, p_kind, p_name)
  on conflict (id) do nothing;
  select p_id;
$$;

-- Posts one entry: the payer is credited and each payee debited, per stream.
-- p_lines: [{account, kind, name, stream, amount}], amounts in cents, zero lines skipped.
create or replace function finance.post(p_table text, p_id bigint, p_memo text, p_payer text, p_payer_name text,
                                        p_currency text, p_lines jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  e bigint;
  l jsonb;
  n integer := 0;
  s text;
  amt bigint;
begin
  if exists (select 1 from finance.entries where source_table = p_table and source_id = p_id and kind = 'paid') then
    return null;
  end if;
  perform finance.account(p_payer, 'sponsor', p_payer_name);
  insert into finance.entries (source_table, source_id, kind, memo) values (p_table, p_id, 'paid', p_memo) returning id into e;
  for l in select * from jsonb_array_elements(p_lines) loop
    amt := (l ->> 'amount')::bigint;
    continue when coalesce(amt, 0) <= 0;
    perform finance.account(l ->> 'account', l ->> 'kind', l ->> 'name');
    n := n + 1;
    insert into finance.lines (entry_id, line_no, account_id, stream, debit_minor, currency)
    values (e, n, l ->> 'account', l ->> 'stream', amt, p_currency);
  end loop;
  -- The payer's side, one credit per stream.
  for s, amt in select x.stream, sum(x.debit_minor) from finance.lines x where x.entry_id = e group by x.stream loop
    n := n + 1;
    insert into finance.lines (entry_id, line_no, account_id, stream, credit_minor, currency)
    values (e, n, p_payer, s, amt, p_currency);
  end loop;
  return e;
end $$;

-- A refund: a new entry with every line of the original swapped.
create or replace function finance.reverse(p_table text, p_id bigint, p_memo text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  orig bigint;
  e bigint;
begin
  select id into orig from finance.entries where source_table = p_table and source_id = p_id and kind = 'paid';
  if orig is null or exists (select 1 from finance.entries where source_table = p_table and source_id = p_id and kind = 'refund') then
    return null;
  end if;
  insert into finance.entries (source_table, source_id, kind, memo, reverses) values (p_table, p_id, 'refund', p_memo, orig) returning id into e;
  insert into finance.lines (entry_id, line_no, account_id, stream, debit_minor, credit_minor, currency)
  select e, line_no, account_id, stream, credit_minor, debit_minor, currency from finance.lines where entry_id = orig;
  return e;
end $$;

-- Sponsor bookings (league and school slots). Posted when the transaction that
-- marks it paid commits, so the school allocations written alongside are there.
create or replace function finance.post_booking(p_id bigint) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  b public.sponsor_bookings;
  sp text;
begin
  select * into b from public.sponsor_bookings where id = p_id;
  select coalesce(s.name, 'Sponsor ' || b.sponsor_id) into sp from public.sponsors s where s.id = b.sponsor_id;
  return finance.post('sponsor_bookings', b.id, 'Sponsorship of league ' || b.pool_id || coalesce(', ' || public.round_name_or_null(b.round), ''),
    'sponsor:' || b.sponsor_id, coalesce(sp, 'Sponsor ' || b.sponsor_id), b.currency,
    jsonb_build_array(
      jsonb_build_object('account', 'scrumline:revenue', 'kind', 'scrumline', 'name', 'Scrumline advertising', 'stream', 'media_fee',
                         'amount', b.scrumline_minor + coalesce(b.extra_fee_minor, 0)),
      jsonb_build_object('account', 'prizes:pot', 'kind', 'prize', 'name', 'Prize pot', 'stream', 'prize', 'amount', b.prize_minor))
    || coalesce((select jsonb_agg(jsonb_build_object(
          'account', coalesce('school:' || a.emis, 'schools:fund'),
          'kind', case when a.emis is null then 'fund' else 'school' end,
          'name', coalesce(sc.name, 'Schools fund'), 'stream', 'gift', 'amount', a.amount_minor) order by a.id)
       from public.school_allocations a left join public.schools sc on sc.emis = a.emis where a.booking_id = b.id), '[]'::jsonb));
end $$;

create or replace function public.round_name_or_null(p_round integer) returns text
language sql immutable set search_path = '' as $$
  select case when p_round is null then null when p_round = 125 then 'quarter-finals' when p_round = 150 then 'semi-finals'
              when p_round = 200 then 'final' else 'round ' || p_round end
$$;

create or replace function finance.on_booking() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('paid', 'live', 'ended') and new.paid_at is not null then
    perform finance.post_booking(new.id);
  end if;
  if new.status in ('refund_due', 'refunded') then
    perform finance.reverse('sponsor_bookings', new.id, 'Refund of sponsorship ' || new.id);
  end if;
  return null;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'finance_booking') then
    create constraint trigger finance_booking after insert or update of status on public.sponsor_bookings
      deferrable initially deferred for each row execute function finance.on_booking();
  end if;
end $$;

-- Tournament sponsors, marked paid by an admin. Their school shares go to the
-- schools of everyone playing that tournament, so they are recorded against
-- the schools' pot until handed out.
create or replace function finance.on_tournament_sponsor() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  sp text;
begin
  if new.paid_at is not null and (tg_op = 'INSERT' or old.paid_at is null) then
    select coalesce(s.name, 'Sponsor ' || new.sponsor_id) into sp from public.sponsors s where s.id = new.sponsor_id;
    perform finance.post('tournament_sponsors', new.id,
      'Tournament sponsorship, ' || new.season_id || coalesce(', ' || public.round_name_or_null(new.round), ''),
      'sponsor:' || new.sponsor_id, coalesce(sp, 'Sponsor ' || new.sponsor_id), new.currency,
      jsonb_build_array(
        jsonb_build_object('account', 'scrumline:revenue', 'kind', 'scrumline', 'name', 'Scrumline advertising', 'stream', 'media_fee', 'amount', new.scrumline_minor),
        jsonb_build_object('account', 'prizes:pot', 'kind', 'prize', 'name', 'Prize pot', 'stream', 'prize', 'amount', new.prize_minor),
        jsonb_build_object('account', 'schools:fund', 'kind', 'fund', 'name', 'Schools fund', 'stream', 'gift',
                           'amount', coalesce(new.own_school_minor, 0) + coalesce(new.partner_school_minor, 0))));
  end if;
  return null;
end $$;
create or replace trigger finance_tournament_sponsor after insert or update of paid_at on public.tournament_sponsors
  for each row execute function finance.on_tournament_sponsor();

-- Pledges to a school project: the project fee is Scrumline's, the rest goes
-- to the project (paid to its supplier).
create or replace function finance.on_pledge() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p public.school_projects;
  fee bigint;
  payer text;
  payer_name text;
begin
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    select * into p from public.school_projects where id = new.project_id;
    fee := case when coalesce(p.target_minor, 0) > 0 then round(new.amount_minor::numeric * coalesce(p.fee_minor, 0) / p.target_minor)::bigint else 0 end;
    if new.sponsor_id is not null then
      payer := 'sponsor:' || new.sponsor_id;
      select coalesce(s.name, 'Sponsor ' || new.sponsor_id) into payer_name from public.sponsors s where s.id = new.sponsor_id;
    else
      payer := 'sponsor:member:' || new.user_id;
      payer_name := 'A player';
    end if;
    perform finance.post('project_pledges', new.id, 'Pledge to ' || coalesce(p.title, 'a school project'),
      payer, coalesce(payer_name, 'Sponsor'), coalesce(p.currency, 'ZAR'),
      jsonb_build_array(
        jsonb_build_object('account', 'scrumline:revenue', 'kind', 'scrumline', 'name', 'Scrumline advertising', 'stream', 'media_fee', 'amount', fee),
        jsonb_build_object('account', 'project:' || new.project_id, 'kind', 'project', 'name', coalesce(p.title, 'School project'), 'stream', 'gift',
                           'amount', new.amount_minor - fee)));
  end if;
  return null;
end $$;
create or replace trigger finance_pledge after insert or update of status on public.project_pledges
  for each row execute function finance.on_pledge();

revoke all on all functions in schema finance from public, anon, authenticated;
revoke all on all tables in schema finance from public, anon, authenticated;

-- Admins: totals per stream and per account.
create or replace function public.finance_summary()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when not public.is_admin_caller() then null else jsonb_build_object(
    'streams', coalesce((select jsonb_agg(jsonb_build_object('stream', stream, 'currency', currency, 'total', total) order by stream)
                         from (select l.stream, l.currency, sum(l.debit_minor) - sum(l.credit_minor) as total
                               from finance.lines l join finance.accounts a on a.id = l.account_id
                               where a.kind <> 'sponsor'
                               group by l.stream, l.currency) s), '[]'::jsonb),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('account', a.id, 'name', a.name, 'kind', a.kind,
                                                              'net', b.net, 'currency', b.currency) order by a.kind, a.name)
                          from finance.accounts a
                          join (select account_id, currency, sum(debit_minor) - sum(credit_minor) as net
                                from finance.lines group by account_id, currency) b on b.account_id = a.id), '[]'::jsonb),
    'entries', (select count(*) from finance.entries)) end
$$;
revoke all on function public.finance_summary() from public, anon;
grant execute on function public.finance_summary() to authenticated;

-- Anything already paid before the ledger existed.
select finance.post_booking(id) from public.sponsor_bookings where status in ('paid', 'live', 'ended') and paid_at is not null;

-- The sponsor pack: live reach numbers and prices for the one-page pack an
-- admin prints or saves as a PDF and sends on. Admins only.
create or replace function public.sponsor_pack()
returns jsonb language sql stable security definer set search_path = '' as $$
  with wk as (select date_trunc('week', now() at time zone 'Africa/Johannesburg')::date as this_week),
  calls as (
    select e.user_id, date_trunc('week', e.at at time zone 'Africa/Johannesburg')::date as week
    from analytics.events e where e.name = 'call_made' and e.user_id is not null group by 1, 2
  )
  select case when not public.is_admin_caller() then null else jsonb_build_object(
    'as_of', now(),
    'players', (select count(*) from public.members),
    'wac', (select count(*) from calls where week = (select this_week from wk)),
    'wac_4w', (select round(avg(n), 0) from (select count(*) as n from calls
                where week between (select this_week from wk) - 28 and (select this_week from wk) - 7 group by week) x),
    'calls_30d', (select count(*) from analytics.events where name = 'call_made' and at > now() - interval '30 days'),
    'chat_30d', (select count(*) from public.chat_messages where created_at > now() - interval '30 days'),
    'leagues', (select count(*) from public.pools p where p.school_emis is null
                and (select count(*) from public.pool_members m where m.pool_id = p.id) >= 4),
    'schools', (select count(distinct emis) from public.member_schools),
    'alerts', round((select count(distinct user_id) from public.push_subscriptions)::numeric
                    / nullif((select count(*) from public.members), 0), 2),
    'tournaments', (select jsonb_agg(jsonb_build_object('name', s.name, 'matches', n.matches, 'from', n.first_ko, 'to', n.last_ko) order by n.first_ko)
                    from public.seasons s
                    join lateral (select count(*) as matches, min(m.kickoff_at) as first_ko, max(m.kickoff_at) as last_ko
                                  from public.matches m where m.season = s.id and m.kickoff_at > now()) n on n.matches > 0
                    where not s.is_replay),
    'prices', (select jsonb_agg(jsonb_build_object('kind', kind, 'min_players', min_players, 'season', season_minor, 'round', round_minor)
                                order by kind, min_players)
               from public.sponsor_prices where country = 'ZA'),
    'given', coalesce((select sum(l.debit_minor) - sum(l.credit_minor) from finance.lines l
                       join finance.accounts a on a.id = l.account_id where l.stream = 'gift' and a.kind <> 'sponsor'), 0)
  ) end
$$;
revoke all on function public.sponsor_pack() from public, anon;
grant execute on function public.sponsor_pack() to authenticated;
