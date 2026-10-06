-- Starting a league returns the new row, but the creator only becomes a member in an
-- AFTER INSERT trigger, so the "see your pools" check failed on that returned row.
-- Let people always see leagues they started. Additive: no existing policy changes.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pools' and policyname = 'see pools you started') then
    create policy "see pools you started" on public.pools for select to authenticated using (created_by = auth.uid());
  end if;
end $$;
