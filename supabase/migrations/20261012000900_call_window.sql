-- Calls open 14 days before kickoff. Real fans wait for team news, so a
-- score can't be called (or changed) further out than that. Calls already
-- made before this rule are kept as they are. SQL run by the owner (no
-- signed-in user) is exempt, for fixes. Mirrors CALL_WINDOW_DAYS in
-- src/lib/rugby.ts.
create or replace function public.call_window_days()
returns int
language sql immutable
as $$ select 14 $$;
grant execute on function public.call_window_days() to anon, authenticated;

create or replace function public.check_call_window()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  k timestamptz;
begin
  if auth.uid() is null then return new; end if;
  -- Banker moves and other untouched scores pass.
  if tg_op = 'UPDATE' and new.home_score is not distinct from old.home_score
     and new.away_score is not distinct from old.away_score then
    return new;
  end if;
  select kickoff_at into k from public.matches where id = new.match_id;
  if k > now() + make_interval(days => public.call_window_days()) then
    raise exception 'Calls open % days before kickoff', public.call_window_days() using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger predictions_call_window before insert or update of home_score, away_score on public.predictions
  for each row execute function public.check_call_window();
