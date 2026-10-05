-- A proper page for every school.
--
-- One call, public.school_page, gives a school's page everything it shows:
-- the school as the Department of Basic Education lists it, its crest, the
-- players who went there and how they're doing this tournament, where the
-- school stands in the schools table, and what has been given to it
-- (sponsors' money and backed projects, with their photos). Members only,
-- like the rest of the app.
--
-- Crests: a school's real crest is added by an admin or by the school's own
-- verified contact, into a public bucket (a crest is the school's public
-- emblem). Until then the app draws a plain shield in the school's own
-- colours, never letters.
--
-- Additive only.

create table if not exists public.school_crests (
  emis       text primary key references public.schools(emis),
  image_path text not null check (image_path ~ '^[0-9]{6,12}/[A-Za-z0-9-]+\.(png|jpg|webp)$'),
  set_by     uuid,  -- who set it; no foreign key, so removing an account never touches crests
  set_at     timestamptz not null default now()
);
alter table public.school_crests enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'school_crests' and policyname = 'members read crests') then
    create policy "members read crests" on public.school_crests for select to authenticated using (true);
  end if;
end $$;
revoke all on public.school_crests from anon;
grant select on public.school_crests to authenticated;

-- An admin, or the school's verified contact.
create or replace function public.can_set_crest(p_emis text)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    exists (select 1 from public.members where user_id = auth.uid() and is_admin)
    or exists (select 1 from public.school_claims c where c.emis = p_emis and c.user_id = auth.uid() and c.status = 'verified'))
$$;
revoke execute on function public.can_set_crest(text) from public, anon;
grant execute on function public.can_set_crest(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('school-crests', 'school-crests', true, 524288, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'crest keepers add crests') then
    create policy "crest keepers add crests" on storage.objects for insert to authenticated
      with check (bucket_id = 'school-crests' and (storage.foldername(name))[1] ~ '^[0-9]{6,12}$'
                  and public.can_set_crest((storage.foldername(name))[1]));
  end if;
end $$;

-- Points the school at a crest already uploaded to its folder.
create or replace function public.set_school_crest(p_emis text, p_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_set_crest(p_emis) then raise exception 'Only the school or an admin can change its crest' using errcode = '42501'; end if;
  if split_part(p_path, '/', 1) <> p_emis then raise exception 'That picture isn''t in this school''s folder' using errcode = '22023'; end if;
  insert into public.school_crests (emis, image_path, set_by) values (p_emis, p_path, auth.uid())
  on conflict (emis) do update set image_path = excluded.image_path, set_by = excluded.set_by, set_at = now();
end $$;
revoke execute on function public.set_school_crest(text, text) from public, anon;
grant execute on function public.set_school_crest(text, text) to authenticated;

-- Everything a school's page shows, for one tournament.
create or replace function public.school_page(p_emis text, p_season text)
returns jsonb
language sql stable
security definer
set search_path = public
as $$
  with s as (
    select * from public.schools where emis = p_emis and public.is_member()
  ), players as (
    select sm.user_id, m.display_name, m.avatar_path, sm.stage, sm.last_year, sm.verified,
           (select coalesce(sum(t.total_pts), 0)::int from public.entries e
              join public.entry_round_totals t on t.entry_id = e.id
             where e.user_id = sm.user_id and e.season = p_season) as pts,
           exists (select 1 from public.entries e where e.user_id = sm.user_id and e.season = p_season) as playing
    from s
    join public.school_members sm on sm.emis = s.emis
    join public.members m on m.user_id = sm.user_id
  ), tables as (
    select st.stage, t.*
    from (values ('high'), ('primary')) st(stage)
    cross join lateral public.school_table(p_season, st.stage) t
    where exists (select 1 from s)
  ), ranked as (
    select t.stage, t.emis, t.score, t.confirmed, t.members,
           case when t.score is not null
                then 1 + (select count(*) from tables x where x.stage = t.stage and x.score > t.score) end as position,
           (select count(*) from tables x where x.stage = t.stage and x.score is not null) as ranked_of
    from tables t
  ), given as (
    select coalesce(sum(a.amount_minor), 0)::bigint as committed_minor,
           coalesce(sum(a.amount_minor) filter (where a.status in ('paid', 'confirmed')), 0)::bigint as paid_minor,
           coalesce(sum(a.amount_minor) filter (where a.status = 'confirmed'), 0)::bigint as confirmed_minor,
           coalesce(array_agg(distinct coalesce(c.display_name, sp.name)) filter (where sp.id is not null), '{}') as sponsors
    from s
    join public.school_allocations a on a.emis = s.emis and a.currency = 'ZAR'
    join public.sponsor_bookings b on b.id = a.booking_id and b.status in ('paid', 'live', 'ended')
    join public.sponsors sp on sp.id = b.sponsor_id and not sp.blocked
    left join public.sponsor_creatives c on c.booking_id = b.id and c.status = 'approved'
  ), projects as (
    select p.*, public.project_state(p) as state
    from s join public.school_projects p on p.emis = s.emis
  )
  select case when not exists (select 1 from s) then null else jsonb_build_object(
    'school', (select jsonb_build_object('emis', emis, 'name', name, 'town', town, 'province', province, 'district', district,
                 'no_fee', no_fee, 'quintile', quintile, 'learners', learners,
                 'offers_primary', offers_primary, 'offers_matric', offers_matric) from s),
    'crest_path', (select image_path from public.school_crests where emis = p_emis),
    'can_set_crest', public.can_set_crest(p_emis),
    'claimed', exists (select 1 from public.school_claims c where c.emis = p_emis and c.status = 'verified'),
    'players', coalesce((select jsonb_agg(jsonb_build_object(
                 'user_id', user_id, 'display_name', display_name, 'avatar_path', avatar_path, 'stage', stage,
                 'last_year', last_year, 'verified', verified, 'pts', pts, 'playing', playing, 'mine', user_id = auth.uid())
                 order by playing desc, pts desc, display_name) from players), '[]'::jsonb),
    'standing', coalesce((select jsonb_agg(jsonb_build_object(
                 'stage', stage, 'position', position, 'of', ranked_of, 'score', score, 'confirmed', confirmed, 'members', members)
                 order by stage) from ranked where emis = p_emis), '[]'::jsonb),
    'given', (select to_jsonb(g) from given g),
    'projects', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', p.id, 'title', p.title, 'why', p.why, 'items', p.items, 'state', p.state,
                 'target_minor', p.target_minor, 'deadline', p.deadline, 'funded_at', p.funded_at,
                 'pledged_minor', coalesce((select sum(amount_minor) from public.project_pledges pl where pl.project_id = p.id and pl.status <> 'lapsed'), 0),
                 'paid_minor', coalesce((select sum(amount_minor) from public.project_pledges pl where pl.project_id = p.id and pl.status = 'paid'), 0),
                 'backers', (select count(*) from public.project_pledges pl where pl.project_id = p.id and pl.status <> 'lapsed'),
                 'photos', coalesce((select jsonb_agg(jsonb_build_object('image_path', x.image_path, 'caption', x.caption) order by x.at)
                                     from (select n.image_path, n.caption, n.at from public.project_need_photos n where n.project_id = p.id
                                           union all
                                           select e.image_path, e.note, e.at from public.project_evidence e
                                            where e.project_id = p.id and e.kind = 'delivery' and e.image_path is not null) x), '[]'::jsonb))
                 order by case p.state when 'open' then 0 when 'funded' then 1 when 'ordered' then 2 when 'delivered' then 3 else 4 end, p.deadline desc)
                 from projects p where p.state <> 'cancelled'), '[]'::jsonb),
    'partners', coalesce((select jsonb_agg(jsonb_build_object('emis', o.emis, 'name', o.name, 'town', o.town, 'distance_km', x.distance_km) order by o.name)
                 from public.school_partners x
                 join public.schools o on o.emis = case when x.emis = p_emis then x.partner_emis else x.emis end
                 where x.emis = p_emis or x.partner_emis = p_emis), '[]'::jsonb)
  ) end
$$;
revoke execute on function public.school_page(text, text) from public, anon;
grant execute on function public.school_page(text, text) to authenticated;
