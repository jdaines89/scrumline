-- Growth sprint: the after-round card, the organiser's view, Monday's line.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;
create function pg_temp.as_user(uid text) returns void language plpgsql as
  $$ begin reset role; perform set_config('request.jwt.claim.sub', uid, false); set role authenticated; end $$;

reset role;
select p.id as lg, p.season as lgseason from public.pools p
  where p.created_by = '00000000-0000-0000-0000-00000000000a' and p.school_emis is null
    and (select count(*) from public.pool_members m where m.pool_id = p.id) >= 3
    and exists (select 1 from public.entries e where e.user_id = '00000000-0000-0000-0000-00000000000a' and e.season = p.season)
    and exists (select 1 from public.matches m where m.season = p.season group by m.round having bool_and(m.home_score is not null))
  order by p.id limit 1 \gset
select max(m.kickoff_at) as lastko, m.round as lastround from public.matches m where m.season = :'lgseason'
  group by m.round having bool_and(m.home_score is not null) order by m.round desc limit 1 \gset
select min(m.kickoff_at) as firstko from public.matches m where m.season = :'lgseason' and m.round = :lastround \gset

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select (j->>'round')::int = :lastround and (j->>'pool_id')::bigint = :lg and (j->>'of')::int >= 3
                             and (j->>'rank')::int between 1 and (j->>'of')::int
                      from public.after_round(:'lgseason', :'lastko'::timestamptz + interval '1 day') j),
                     'after a round: your score and place in the league you started');
select pg_temp.check(public.after_round(:'lgseason', :'lastko'::timestamptz + interval '6 days') is null,
                     'the card is gone five days after the round');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ff');
select pg_temp.check(public.after_round(:'lgseason', :'lastko'::timestamptz + interval '1 day') is null,
                     'no card for someone without a team in that tournament');

-- The organiser sees counts for the next round; nobody else sees anything
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.organiser_round(:lg, :'firstko'::timestamptz - interval '1 day'))
                     = (select count(*) from public.pool_members where pool_id = :lg)
                     and (select bool_and(round = :lastround and called between 0 and games)
                          from public.organiser_round(:lg, :'firstko'::timestamptz - interval '1 day')),
                     'the organiser sees each member''s calls counted for the next round');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.organiser_round(:lg, :'firstko'::timestamptz - interval '1 day')) = 0,
                     'a member who didn''t start the league sees nothing');

-- Monday's line
reset role;
select pg_temp.check(notify.growth_line() like 'Last week % called (sprint target 100 a week by 29 Nov). %players in all.',
                     'the growth line reads as one sentence');
set role authenticated;
do $$ begin
  perform notify.growth_line();
  raise exception 'FAILED: a player read the growth line';
exception when insufficient_privilege then raise notice 'ok: only the database sends the growth line';
end $$;
reset role;
\echo GROWTH CHECKS PASSED
