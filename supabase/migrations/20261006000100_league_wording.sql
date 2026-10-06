-- Players see "league", never "pool". Reword the messages the database sends back,
-- keeping each function exactly as it is otherwise (CREATE OR REPLACE of its own definition).
do $$
declare
  f regprocedure;
  def text;
begin
  foreach f in array array['public.join_pool(text)'::regprocedure, 'public.check_pool_name()'::regprocedure, 'public.chat_check(bigint,text)'::regprocedure] loop
    def := pg_get_functiondef(f);
    def := replace(def, 'No pool has that code', 'No league has that code');
    def := replace(def, 'Only league members can join pools', 'Only Scrumline members can join leagues');
    def := replace(def, 'Official school pools are made', 'Official school leagues are made');
    def := replace(def, 'not in this pool.', 'not in this league.');
    execute def;
  end loop;
end $$;
