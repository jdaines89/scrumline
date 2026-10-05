-- The money ledger: posts itself, balances, never changes. Runs after the
-- other tests, which pay (and refund) sponsor bookings along the way.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;

select pg_temp.check((select count(*) from public.sponsor_bookings where paid_at is not null) > 0, 'the earlier tests paid some bookings');
select pg_temp.check(not exists (select 1 from public.sponsor_bookings b where b.paid_at is not null and b.status in ('paid', 'live', 'ended')
                       and not exists (select 1 from finance.entries e where e.source_table = 'sponsor_bookings' and e.source_id = b.id and e.kind = 'paid')),
                     'every paid booking has a ledger entry');
select pg_temp.check(not exists (select 1 from finance.lines group by entry_id, stream having sum(debit_minor) <> sum(credit_minor)),
                     'every entry balances per stream');
select pg_temp.check(not exists (
  select 1 from public.sponsor_bookings b join finance.entries e on e.source_table = 'sponsor_bookings' and e.source_id = b.id and e.kind = 'paid'
  where (select sum(credit_minor) from finance.lines l where l.entry_id = e.id)
        <> b.scrumline_minor + coalesce(b.extra_fee_minor, 0) + b.prize_minor
           + coalesce((select sum(amount_minor) from public.school_allocations a where a.booking_id = b.id), 0)),
  'what the sponsor paid is the fee, the prize share and each school''s gift');
select pg_temp.check((select sum(l.debit_minor) from finance.lines l where l.account_id = 'scrumline:revenue' and l.stream = 'media_fee') > 0
                     and not exists (select 1 from finance.lines l where l.account_id like 'school:%' and l.stream <> 'gift'),
                     'advertising is Scrumline revenue; school money is only ever a gift');

do $$ begin
  update finance.lines set debit_minor = debit_minor + 1 where entry_id = (select min(entry_id) from finance.lines);
  raise exception 'FAILED: a ledger line was edited';
exception when raise_exception then
  if sqlerrm like 'FAILED%' then raise; end if;
  raise notice 'ok: ledger lines can''t be edited';
end $$;
do $$ begin
  delete from finance.entries where id = (select min(id) from finance.entries);
  raise exception 'FAILED: a ledger entry was deleted';
exception when raise_exception then
  if sqlerrm like 'FAILED%' then raise; end if;
  raise notice 'ok: ledger entries can''t be deleted';
end $$;

-- An entry that doesn't balance is refused when its transaction commits.
do $$ declare e bigint; begin
  begin
    insert into finance.entries (source_table, source_id, kind, memo) values ('test', 1, 'paid', 'lopsided') returning id into e;
    insert into finance.lines (entry_id, line_no, account_id, stream, debit_minor) values (e, 1, 'scrumline:revenue', 'media_fee', 100);
    set constraints all immediate;
    raise exception 'FAILED: an unbalanced entry was accepted';
  exception when raise_exception then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice 'ok: an entry that doesn''t balance is refused';
  end;
end $$;

-- A refund reverses the original in a new entry.
select id as rb from public.sponsor_bookings where paid_at is not null and status in ('paid', 'live') order by id limit 1 \gset
update public.sponsor_bookings set status = 'refunded' where id = :rb;
select pg_temp.check((select count(*) from finance.entries where source_table = 'sponsor_bookings' and source_id = :rb) = 2
                     and (select sum(l.debit_minor) - sum(l.credit_minor) from finance.lines l join finance.entries e on e.id = l.entry_id
                          where e.source_table = 'sponsor_bookings' and e.source_id = :rb and l.account_id = 'scrumline:revenue') = 0,
                     'a refund is a new entry that cancels the original');

-- Only admins see the totals.
select set_config('request.jwt.claim.sub', (select user_id::text from public.members where not is_admin limit 1), false);
set role authenticated;
select pg_temp.check(public.finance_summary() is null and public.sponsor_pack() is null, 'a player can''t see the money totals or the sponsor pack');
reset role;
select set_config('request.jwt.claim.sub', '', false);

select pg_temp.check((public.sponsor_pack() ->> 'players')::int > 0 and jsonb_array_length(public.sponsor_pack() -> 'prices') > 0
                     and (public.finance_summary() ->> 'entries')::int > 0, 'an admin gets the pack numbers, prices and ledger totals');

do $$ begin raise notice 'FINANCE CHECKS PASSED'; end $$;
