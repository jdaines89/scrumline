-- Schools: finding one signed out, and photos of what a project is for.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;
create function pg_temp.as_user(uid text) returns void language plpgsql as
  $$ begin reset role; perform set_config('request.jwt.claim.sub', uid, false); set role authenticated; end $$;

-- Signed out: the public list's name, town and number, nothing else
reset role; select set_config('request.jwt.claim.sub', '', false);
select name as sname, emis as semis from public.schools order by learners desc nulls last limit 1 \gset
set role anon;
select pg_temp.check((select count(*) from public.find_school(:'sname') where emis = :'semis') = 1, 'a signed-out visitor finds a school by name');
select pg_temp.check((select count(*) from public.find_school('ab')) = 0, 'two letters find nothing');
do $$ begin
  perform public.search_schools('school', 'high');
  raise exception 'FAILED: signed-out search reached the full school rows';
exception when insufficient_privilege then raise notice 'ok: the full search stays for signed-in accounts';
end $$;
reset role;

-- Photos of the need: admins only, before the project is backed, four at most
select id as openproj from public.school_projects where status = 'active' and funded_at is null limit 1 \gset
select id as fundedproj from public.school_projects where funded_at is not null limit 1 \gset
create temp table needref as select :openproj::bigint as open_id, :fundedproj::bigint as funded_id;
grant select on needref to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  perform public.admin_add_need_photo((select open_id from needref),
    (select open_id from needref) || '/x.jpg', 'Worn balls');
  raise exception 'FAILED: a player added a project photo';
exception when insufficient_privilege then raise notice 'ok: only admins add photos of the need';
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.admin_add_need_photo(:openproj, :openproj || '/a.jpg', 'The old balls');
select public.admin_add_need_photo(:openproj, :openproj || '/b.jpg', null);
select public.admin_add_need_photo(:openproj, :openproj || '/c.jpg', null);
select public.admin_add_need_photo(:openproj, :openproj || '/d.jpg', null);
do $$ begin
  perform public.admin_add_need_photo((select open_id from needref),
    (select open_id from needref) || '/e.jpg', null);
  raise exception 'FAILED: a fifth photo went on';
exception when raise_exception then
  if sqlerrm like 'FAILED%' then raise; end if;
  raise notice 'ok: four photos at most';
end $$;
do $$ begin
  perform public.admin_add_need_photo((select funded_id from needref),
    (select funded_id from needref) || '/f.jpg', null);
  raise exception 'FAILED: changed the picture after people pledged';
exception when raise_exception then
  if sqlerrm like 'FAILED%' then raise; end if;
  raise notice 'ok: the picture is fixed once a project is backed';
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.project_need_photos_list() where project_id = :openproj) = 4
                     and (select caption from public.project_need_photos_list() where project_id = :openproj order by at limit 1) = 'The old balls',
                     'players see the photos of the need');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ff');
select pg_temp.check((select count(*) from public.project_need_photos_list()) = 0, 'outsiders see none');
reset role;
select pg_temp.check(not exists (select 1 from public.pools p join public.schools s on s.emis = p.school_emis
                                 where p.full_name is distinct from s.name || coalesce(' Class of ' || p.school_year, '')),
                     'every school league carries the school''s full name');
select pg_temp.check(not exists (select 1 from public.pools where school_emis is null and full_name is not null),
                     'mates'' leagues have no school name');

-- A school's page: members only; the crest is set by an admin or the school's verified contact
reset role;
select emis as pemis from public.member_schools order by emis limit 1 \gset
select id as pseason from public.seasons order by id limit 1 \gset
create temp table pageref as select :'pemis'::text as emis;
grant select on pageref to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((public.school_page(:'pemis', :'pseason') -> 'school' ->> 'name') = (select name from public.schools where emis = :'pemis'),
                     'a player opens a school''s page with its full name');
select pg_temp.check(jsonb_array_length(public.school_page(:'pemis', :'pseason') -> 'players') =
                     (select count(*) from public.member_schools where emis = :'pemis'), 'the page lists everyone who went there');
select pg_temp.check(not (public.school_page(:'pemis', :'pseason') ->> 'can_set_crest')::boolean, 'a player can''t change the crest');
do $$ begin
  perform public.set_school_crest((select emis from pageref), (select emis from pageref) || '/crest.png');
  raise exception 'FAILED: a player set a school''s crest';
exception when insufficient_privilege then raise notice 'ok: players can''t set a crest';
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ff');
select pg_temp.check(public.school_page(:'pemis', :'pseason') is null, 'outsiders get no school page');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  perform public.set_school_crest((select emis from pageref), '999999/crest.png');
  raise exception 'FAILED: crest taken from another school''s folder';
exception when invalid_parameter_value then raise notice 'ok: a crest comes from the school''s own folder';
end $$;
select public.set_school_crest(:'pemis', :'pemis' || '/crest-1.png');
select public.set_school_crest(:'pemis', :'pemis' || '/crest-2.png');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((public.school_page(:'pemis', :'pseason') ->> 'crest_path') = :'pemis' || '/crest-2.png', 'the newest crest shows');
reset role;
\echo SCHOOLS CHECKS PASSED
