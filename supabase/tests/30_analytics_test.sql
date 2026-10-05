-- Product analytics: triggers log what players do, the app can only add its own
-- events, and only admins see the numbers. Runs after 10_rls_test.sql.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', uid::text, false);
end $$;

select pg_temp.check((select count(*) from analytics.events where name = 'signed_up')
                     = (select count(*) from public.members), 'every member has a signed_up event');
select pg_temp.check((select count(*) from analytics.events where name = 'call_made') > 0, 'calls are logged as they happen');
select pg_temp.check(not exists (select 1 from analytics.events e left join analytics.event_names n using (name) where n.name is null),
                     'every event is in the catalogue');

create temp table who as
  select (select user_id from public.members where not is_admin order by joined_at limit 1) as player,
         (select user_id from public.members where is_admin order by joined_at limit 1) as admin;
grant select on who to authenticated;

select pg_temp.as_user((select player from who));
select public.log_event('invite_shared', '{"via":"whatsapp"}');
do $$ begin
  perform public.log_event('call_made');
  raise exception 'FAILED: the app could fake a server event';
exception when check_violation then raise notice 'ok: the app can''t send server events';
end $$;
do $$ begin
  perform 1 from analytics.events limit 1;
  raise exception 'FAILED: a player could read the event log';
exception when insufficient_privilege then raise notice 'ok: players can''t read the event log';
end $$;
select pg_temp.check(public.gate_metrics() is null, 'players don''t see the metrics');
reset role;
select pg_temp.check(exists (select 1 from analytics.events e, who where e.name = 'invite_shared'
                     and e.user_id = who.player and e.props->>'via' = 'whatsapp'), 'app events land for the signed-in player');

select pg_temp.as_user((select admin from who));
select pg_temp.check((public.gate_metrics()->>'players')::int = (select count(*) from public.members)
                     and jsonb_array_length(public.gate_metrics()->'wac_weeks') = 12
                     and jsonb_array_length(public.gate_metrics()->'targets') = 3, 'admins see the 90-day metrics');
reset role;

do $$ begin raise notice 'ANALYTICS CHECKS PASSED'; end $$;
