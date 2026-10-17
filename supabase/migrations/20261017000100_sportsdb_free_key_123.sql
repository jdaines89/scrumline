-- TheSportsDB switched off the old free key "3" (every request now gets a
-- 403 "permanently disabled"), so no scores landed after 15 Oct. The free
-- key is now "123". Swap it into every function that calls the feed.
do $$
declare
  f record;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'raw' and p.prokind = 'f'
      and pg_get_functiondef(p.oid) like '%thesportsdb.com/api/v1/json/3/%'
  loop
    execute replace(pg_get_functiondef(f.oid),
                    'thesportsdb.com/api/v1/json/3/', 'thesportsdb.com/api/v1/json/123/');
  end loop;
end $$;

-- Ask again straight away for every finished match still missing a score.
select raw.request_live();
