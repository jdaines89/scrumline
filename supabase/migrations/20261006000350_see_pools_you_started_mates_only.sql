-- School and class leagues are made by the app on someone's behalf, so their
-- created_by is whoever happened to trigger them. Only leagues you started
-- yourself (never school ones) count for "see pools you started"; school and
-- class leagues stay visible to their members only.
alter policy "see pools you started" on public.pools using (created_by = auth.uid() and school_emis is null);
