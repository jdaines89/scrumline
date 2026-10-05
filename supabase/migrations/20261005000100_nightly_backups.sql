-- Nightly backups of every player-owned table, kept for 14 days, inside the
-- database. The free Supabase plan gives no restorable backups, and the app
-- holds real players' calls, scores and chat.
--
-- Shape: one row per (slot, table). The slot is the day number mod 14, so each
-- night overwrites the snapshot from two weeks ago. Nothing is ever deleted,
-- which also keeps this migration and the job free of destructive statements.
--
-- Covered: every table in public (new tables are picked up automatically)
-- except the reference list of schools, which a migration reloads; plus the
-- sign-in identities in auth.users (id, email, created, metadata).
--
-- Restore is non-destructive: backup.restore_missing() puts back rows that are
-- gone (matched on the primary key) and never overwrites a row that exists.
--   select * from backup.list();                         -- what's there
--   select backup.restore_missing('predictions', 3);     -- slot 3 back in
--   select * from backup.rows('predictions', 3);         -- inspect first
create schema if not exists backup;
revoke all on schema backup from public, anon, authenticated;

create table if not exists backup.snapshots (
  slot      smallint    not null check (slot between 0 and 13),
  tbl       text        not null,
  taken_at  timestamptz not null default now(),
  row_count integer     not null,
  rows      jsonb       not null,
  primary key (slot, tbl)
);
revoke all on backup.snapshots from public, anon, authenticated;

create or replace function backup.slot_for(d date) returns smallint
language sql immutable as $$ select ((d - date '2026-01-01') % 14)::smallint $$;

-- Takes tonight's snapshot. Returns the number of tables saved.
create or replace function backup.take() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  s smallint := backup.slot_for((now() at time zone 'Africa/Johannesburg')::date);
  t record; n integer := 0; j jsonb; cnt integer;
begin
  for t in
    select pc.relname from pg_class pc join pg_namespace ns on ns.oid = pc.relnamespace
    where ns.nspname = 'public' and pc.relkind in ('r', 'p') and pc.relname <> 'schools'
    order by pc.relname
  loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''), count(*) from public.%I x', t.relname)
      into j, cnt;
    insert into backup.snapshots (slot, tbl, taken_at, row_count, rows)
    values (s, t.relname, now(), cnt, j)
    on conflict (slot, tbl) do update
      set taken_at = excluded.taken_at, row_count = excluded.row_count, rows = excluded.rows;
    n := n + 1;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'email', u.email,
           'created_at', u.created_at, 'raw_user_meta_data', u.raw_user_meta_data)), '[]'), count(*)
    into j, cnt from auth.users u;
  insert into backup.snapshots (slot, tbl, taken_at, row_count, rows)
  values (s, 'auth.users', now(), cnt, j)
  on conflict (slot, tbl) do update
    set taken_at = excluded.taken_at, row_count = excluded.row_count, rows = excluded.rows;
  return n + 1;
end $$;

-- What is in each slot, newest first.
create or replace function backup.list()
returns table (slot smallint, taken_at timestamptz, tables integer, total_rows bigint)
language sql stable security definer set search_path = '' as $$
  select s.slot, max(s.taken_at), count(*)::integer, sum(s.row_count)
  from backup.snapshots s group by s.slot order by 2 desc
$$;

-- One table's rows from a slot, as records of that table.
create or replace function backup.rows(p_tbl text, p_slot integer)
returns setof jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_array_elements(s.rows) from backup.snapshots s where s.tbl = p_tbl and s.slot = p_slot
$$;

-- Puts back rows of a public table that are missing now. Existing rows are left
-- alone (on conflict do nothing). Returns how many rows came back.
create or replace function backup.restore_missing(p_tbl text, p_slot integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare cols text; n integer;
begin
  if not exists (select 1 from backup.snapshots where tbl = p_tbl and slot = p_slot) then
    raise exception 'no snapshot of % in slot %', p_tbl, p_slot;
  end if;
  -- Generated columns are recomputed; identity columns keep their saved values.
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
  from pg_attribute a
  where a.attrelid = format('public.%I', p_tbl)::regclass
    and a.attnum > 0 and not a.attisdropped and a.attgenerated = '';
  execute format(
    'insert into public.%1$I (%2$s) overriding system value
       select %2$s from jsonb_populate_recordset(null::public.%1$I,
         (select rows from backup.snapshots where tbl = %3$L and slot = %4$s))
     on conflict do nothing', p_tbl, cols, p_tbl, p_slot);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on all functions in schema backup from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    -- 01:15 SAST, after the evening's results are in and before anyone wakes.
    perform cron.schedule('nightly-backup', '15 23 * * *', 'select backup.take()');
  end if;
end $$;

-- First snapshot straight away, so there is one before tonight.
select backup.take();
