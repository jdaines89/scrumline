-- Players could not create a league with "Count from round" chosen: counts_from_round
-- was never in the column-level insert grant (permission denied for table pools).
grant insert (counts_from_round) on public.pools to authenticated;
