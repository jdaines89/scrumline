-- A call belongs to the entry for its own tournament.
--
-- Predict kept saving under the first tournament opened, so after switching
-- to another one, calls landed on the wrong entry (e.g. Champions Cup calls on
-- a URC entry). The new tournament's entry then had no calls, so Lock failed
-- and the Banker and Lock buttons vanished. The app is fixed; this makes the
-- database refuse such a call outright, whoever sends it.
create or replace function public.check_prediction()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  r record := coalesce(new, old);
  m public.matches;
begin
  if tg_op = 'UPDATE' and (new.entry_id <> old.entry_id or new.match_id <> old.match_id) then
    raise exception 'A call can''t be moved to another match' using errcode = 'P0001';
  end if;
  select * into m from public.matches where id = r.match_id;
  if tg_op = 'INSERT' and not exists (
    select 1 from public.entries e where e.id = new.entry_id and e.season = m.season
  ) then
    raise exception 'That match is in another tournament' using errcode = 'P0001';
  end if;
  if public.prediction_locked(r.entry_id, r.match_id) then
    raise exception 'That match is locked' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.is_banker then
    update public.predictions p set is_banker = false
    from public.matches o
    where p.entry_id = new.entry_id and p.is_banker and p.match_id <> new.match_id
      and o.id = p.match_id and o.season = m.season and o.round = m.round;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
