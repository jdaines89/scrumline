-- School projects: one real thing a school needs (20 match balls, a set of
-- tackle bags, a water tank) at a fixed supplier price, backed by named
-- businesses and players, bought and delivered by the Foundation, with proof.
--
-- Built to be hard to get wrong:
--   * Only the Foundation (admins) lists a project, from a supplier's fixed
--     price, capped at R25,000, so there is no building work and no estimate.
--   * A pledge is a promise, not a payment. Nobody pays anything until the
--     whole target is pledged, so a project that falls short costs nobody
--     anything and nothing is left half-bought. After the deadline an
--     unfunded project simply closes.
--   * Once it is fully pledged, pledges lock and backers pay the Foundation.
--     A pledge not paid shows publicly as not paid, and its amount opens up
--     again for someone else (past the deadline too, because by then some
--     backers have paid).
--   * The Foundation orders only once every pledge is paid, and a project is
--     marked delivered only with a delivery photo on record. Evidence is
--     append-only: nothing posted can be edited or removed.
--   * Every backer is named: a business by its Scrumline business name, a
--     player by their display name.

create table public.school_projects (
  id           bigint generated always as identity primary key,
  emis         text not null references public.schools(emis),
  title        text not null check (length(btrim(title)) between 3 and 60),
  why          text not null check (length(btrim(why)) between 3 and 280),
  items        text not null check (length(btrim(items)) between 3 and 280),
  supplier     text not null check (length(btrim(supplier)) between 2 and 80),
  target_minor bigint not null check (target_minor between 10000 and 2500000),
  currency     text not null default 'ZAR' check (currency ~ '^[A-Z]{3}$'),
  deadline     date not null,
  status       text not null default 'active' check (status in ('active', 'ordered', 'delivered', 'cancelled')),
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  funded_at    timestamptz,  -- the first time pledges reached the target; from then on those pledges are locked
  ordered_at   timestamptz,
  delivered_at timestamptz
);
create index school_projects_emis on public.school_projects (emis);

create table public.project_pledges (
  id           bigint generated always as identity primary key,
  project_id   bigint not null references public.school_projects(id) on delete cascade,
  user_id      uuid not null references auth.users(id) default auth.uid(),
  sponsor_id   bigint references public.sponsors(id),
  amount_minor bigint not null check (amount_minor >= 5000),
  status       text not null default 'pledged' check (status in ('pledged', 'paid', 'lapsed')),
  created_at   timestamptz not null default now(),
  settled_at   timestamptz
);
create index project_pledges_project on public.project_pledges (project_id);

create table public.project_evidence (
  id         bigint generated always as identity primary key,
  project_id bigint not null references public.school_projects(id) on delete cascade,
  kind       text not null check (kind in ('quote', 'order', 'delivery', 'note')),
  note       text check (length(btrim(note)) between 1 and 280),
  image_path text check (image_path ~ '^\d+/[A-Za-z0-9_-]{1,64}\.jpg$'),
  posted_by  uuid references auth.users(id) default auth.uid(),
  at         timestamptz not null default now(),
  check (note is not null or image_path is not null),
  check (image_path is null or split_part(image_path, '/', 1) = project_id::text)
);

-- Nobody touches these tables directly: everything goes through the
-- functions below, which carry the rules.
alter table public.school_projects enable row level security;
alter table public.project_pledges enable row level security;
alter table public.project_evidence enable row level security;
revoke all on public.school_projects, public.project_pledges, public.project_evidence from anon, authenticated;

-- Photos can show learners, so they are private: any signed-in account can
-- view them through a short-lived link, and only admins upload.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-photos', 'project-photos', false, 1048576, array['image/jpeg'])
on conflict (id) do nothing;
create policy "signed-in accounts see project photos" on storage.objects for select to authenticated
  using (bucket_id = 'project-photos' and (public.is_member() or public.is_business() or public.is_school_account()));
create policy "admins add project photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'project-photos' and exists (select 1 from public.members where user_id = auth.uid() and is_admin));

-- Where a project stands. Open and funded come from the pledges, never from
-- a person: funded the moment live pledges reach the target.
create or replace function public.project_state(p public.school_projects)
returns text
language sql stable
security definer
set search_path = public
as $$
  select case
    when p.status <> 'active' then p.status
    when (select coalesce(sum(amount_minor), 0) from public.project_pledges
          where project_id = p.id and status <> 'lapsed') >= p.target_minor then 'funded'
    when p.funded_at is null and p.deadline < (now() at time zone 'Africa/Johannesburg')::date then 'missed'
    else 'open' end
$$;
revoke execute on function public.project_state(public.school_projects) from public, anon;

-- Every project with its backers and evidence, for anyone signed in.
create or replace function public.school_projects_list()
returns table (id bigint, emis text, school text, town text, no_fee boolean, title text, why text, items text,
               supplier text, target_minor bigint, currency text, deadline date, state text,
               pledged_minor bigint, paid_minor bigint, funded_once boolean, my_school boolean, backers jsonb, evidence jsonb)
language sql stable
security definer
set search_path = public
as $$
  select p.id, p.emis, s.name, s.town, s.no_fee, p.title, p.why, p.items, p.supplier, p.target_minor, p.currency,
         p.deadline, public.project_state(p),
         coalesce((select sum(amount_minor) from public.project_pledges pl where pl.project_id = p.id and pl.status <> 'lapsed'), 0)::bigint,
         coalesce((select sum(amount_minor) from public.project_pledges pl where pl.project_id = p.id and pl.status = 'paid'), 0)::bigint,
         p.funded_at is not null,
         exists (select 1 from public.member_schools ms where ms.user_id = auth.uid() and ms.emis = p.emis)
           or exists (select 1 from public.school_claims c where c.user_id = auth.uid() and c.emis = p.emis and c.status in ('needs_review', 'verified')),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'id', pl.id, 'name', coalesce(sp.name, case when public.is_member() then m.display_name end, 'A player'), 'business', pl.sponsor_id is not null,
                     'amount_minor', pl.amount_minor, 'status', pl.status, 'mine', pl.user_id = auth.uid()) order by pl.created_at)
                   from public.project_pledges pl
                   left join public.sponsors sp on sp.id = pl.sponsor_id
                   left join public.members m on m.user_id = pl.user_id
                   where pl.project_id = p.id), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'note', e.note, 'image_path', e.image_path, 'at', e.at) order by e.at)
                   from public.project_evidence e where e.project_id = p.id), '[]'::jsonb)
  from public.school_projects p
  join public.schools s on s.emis = p.emis
  where public.is_member() or public.is_business() or public.is_school_account()
  order by case public.project_state(p) when 'open' then 0 when 'funded' then 1 when 'ordered' then 2 when 'delivered' then 3 else 4 end,
           p.deadline, p.id
$$;
revoke execute on function public.school_projects_list() from public, anon;
grant execute on function public.school_projects_list() to authenticated;

-- Back a project: a business in its own name, or a player in theirs. Only
-- while it's open, and never past the target.
create or replace function public.pledge_project(p_project bigint, p_amount_minor bigint, p_sponsor bigint default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.school_projects;
  pledged bigint;
  new_id bigint;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_sponsor is not null then
    if not exists (select 1 from public.my_businesses() b where b.id = p_sponsor) then
      raise exception 'You can only back a project in the name of a business you run' using errcode = '42501';
    end if;
  elsif not public.is_member() then
    raise exception 'Set up your business profile first' using errcode = '42501';
  end if;
  select * into p from public.school_projects where id = p_project for update;
  if p.id is null or public.project_state(p) <> 'open' then
    raise exception 'This project isn''t taking pledges' using errcode = 'P0001';
  end if;
  select coalesce(sum(amount_minor), 0) into pledged from public.project_pledges where project_id = p.id and status <> 'lapsed';
  if p_amount_minor is null or p_amount_minor < 5000 then
    raise exception 'The smallest pledge is R50' using errcode = '22023';
  end if;
  if p_amount_minor > p.target_minor - pledged then
    raise exception 'Only R% is still needed', to_char((p.target_minor - pledged) / 100.0, 'FM999G999G990') using errcode = '22023';
  end if;
  insert into public.project_pledges (project_id, user_id, sponsor_id, amount_minor)
  values (p.id, auth.uid(), p_sponsor, p_amount_minor)
  returning id into new_id;
  if pledged + p_amount_minor >= p.target_minor and p.funded_at is null then
    update public.school_projects set funded_at = now() where id = p.id;
  end if;
  return new_id;
end $$;
revoke execute on function public.pledge_project(bigint, bigint, bigint) from public, anon;
grant execute on function public.pledge_project(bigint, bigint, bigint) to authenticated;

-- Take a pledge back, only while the project is still open.
create or replace function public.withdraw_pledge(p_pledge bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pl public.project_pledges;
  p public.school_projects;
begin
  select * into pl from public.project_pledges where id = p_pledge;
  if pl.id is null or pl.user_id <> auth.uid() then raise exception 'Not your pledge' using errcode = '42501'; end if;
  select * into p from public.school_projects where id = pl.project_id for update;
  if public.project_state(p) <> 'open' or pl.status <> 'pledged' or (p.funded_at is not null and pl.created_at <= p.funded_at) then
    raise exception 'Pledges lock once a project is fully backed' using errcode = 'P0001';
  end if;
  delete from public.project_pledges where id = pl.id;
end $$;
revoke execute on function public.withdraw_pledge(bigint) from public, anon;
grant execute on function public.withdraw_pledge(bigint) to authenticated;

-- The Foundation's side ---------------------------------------------------

create or replace function public.admin_create_project(p_emis text, p_title text, p_why text, p_items text,
                                                       p_supplier text, p_target_minor bigint, p_deadline date)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id bigint;
begin
  if not public.is_admin_caller() then raise exception 'Admins only' using errcode = '42501'; end if;
  if p_deadline < (now() at time zone 'Africa/Johannesburg')::date + 7 then
    raise exception 'Give backers at least a week' using errcode = '22023';
  end if;
  insert into public.school_projects (emis, title, why, items, supplier, target_minor, deadline)
  values (p_emis, btrim(p_title), btrim(p_why), btrim(p_items), btrim(p_supplier), p_target_minor, p_deadline)
  returning id into new_id;
  return new_id;
end $$;

-- A pledge is marked paid, or lapsed when it wasn't paid (which opens its
-- amount again). Only once the project is fully backed.
create or replace function public.admin_settle_pledge(p_pledge bigint, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pl public.project_pledges;
  p public.school_projects;
begin
  if not public.is_admin_caller() then raise exception 'Admins only' using errcode = '42501'; end if;
  if p_status not in ('paid', 'lapsed') then raise exception 'Paid or lapsed' using errcode = '22023'; end if;
  select * into pl from public.project_pledges where id = p_pledge for update;
  select * into p from public.school_projects where id = pl.project_id for update;
  if pl.status <> 'pledged' then raise exception 'That pledge is already settled' using errcode = 'P0001'; end if;
  if p.funded_at is null or p.status <> 'active' then
    raise exception 'Pledges are settled only once the project is fully backed' using errcode = 'P0001';
  end if;
  update public.project_pledges set status = p_status, settled_at = now() where id = pl.id;
end $$;

-- Evidence goes on the record for good.
create or replace function public.admin_add_evidence(p_project bigint, p_kind text, p_note text, p_image_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_caller() then raise exception 'Admins only' using errcode = '42501'; end if;
  insert into public.project_evidence (project_id, kind, note, image_path)
  values (p_project, p_kind, nullif(btrim(coalesce(p_note, '')), ''), p_image_path);
end $$;

-- Ordered only when every pledge is paid; delivered only with a delivery
-- photo on record; cancelled only before anything is ordered.
create or replace function public.admin_advance_project(p_project bigint, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.school_projects;
  st text;
begin
  if not public.is_admin_caller() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into p from public.school_projects where id = p_project for update;
  if p.id is null then raise exception 'No such project' using errcode = '22023'; end if;
  st := public.project_state(p);
  if p_status = 'ordered' then
    if st <> 'funded' or exists (select 1 from public.project_pledges where project_id = p.id and status = 'pledged')
       or (select coalesce(sum(amount_minor), 0) from public.project_pledges where project_id = p.id and status = 'paid') < p.target_minor then
      raise exception 'Order only once every pledge is paid' using errcode = 'P0001';
    end if;
    update public.school_projects set status = 'ordered', ordered_at = now() where id = p.id;
  elsif p_status = 'delivered' then
    if st <> 'ordered' then raise exception 'Mark it ordered first' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.project_evidence where project_id = p.id and kind = 'delivery' and image_path is not null) then
      raise exception 'Post a delivery photo first' using errcode = 'P0001';
    end if;
    update public.school_projects set status = 'delivered', delivered_at = now() where id = p.id;
  elsif p_status = 'cancelled' then
    if st in ('ordered', 'delivered') then raise exception 'Too late to cancel' using errcode = 'P0001'; end if;
    if exists (select 1 from public.project_pledges where project_id = p.id and status = 'paid') then
      raise exception 'Money has been paid; refund it before cancelling' using errcode = 'P0001';
    end if;
    update public.school_projects set status = 'cancelled' where id = p.id;
  else
    raise exception 'Ordered, delivered or cancelled' using errcode = '22023';
  end if;
end $$;

revoke execute on function public.admin_create_project(text, text, text, text, text, bigint, date),
  public.admin_settle_pledge(bigint, text), public.admin_add_evidence(bigint, text, text, text),
  public.admin_advance_project(bigint, text) from public, anon;
grant execute on function public.admin_create_project(text, text, text, text, text, bigint, date),
  public.admin_settle_pledge(bigint, text), public.admin_add_evidence(bigint, text, text, text),
  public.admin_advance_project(bigint, text) to authenticated;
