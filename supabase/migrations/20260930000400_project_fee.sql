-- School projects pay their way: every project carries a Scrumline project
-- fee on top of the supplier's price, shown on the card as its own line
-- ("R4,000 for the balls + R600 project fee"). It pays for finding the
-- supplier, checking the quote, collecting pledges, ordering, and getting the
-- delivery proof. The rate is stored on each project when it is listed, so a
-- later change to the rate never rewrites a project people have already seen.
--
-- The target backers pledge towards is the price plus the fee. The R25,000
-- cap now applies to the supplier's price.

alter table public.school_projects drop column target_minor;
alter table public.school_projects
  add column price_minor bigint not null check (price_minor between 10000 and 2500000),
  add column fee_bps     int    not null default 1500 check (fee_bps between 0 and 3000),
  add column fee_minor   bigint not null default 0 check (fee_minor >= 0);
alter table public.school_projects
  add column target_minor bigint generated always as (price_minor + fee_minor) stored;

-- The fee is always worked out from the price and the rate, never typed.
create or replace function public.school_project_fee()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.fee_minor := round(new.price_minor * new.fee_bps / 10000.0)::bigint;
  return new;
end $$;
create trigger school_project_fee before insert or update of price_minor, fee_bps on public.school_projects
  for each row execute function public.school_project_fee();

drop function public.school_projects_list();
create function public.school_projects_list()
returns table (id bigint, emis text, school text, town text, no_fee boolean, title text, why text, items text,
               supplier text, price_minor bigint, fee_minor bigint, fee_bps int, target_minor bigint, currency text, deadline date, state text,
               pledged_minor bigint, paid_minor bigint, funded_once boolean, my_school boolean, backers jsonb, evidence jsonb)
language sql stable
security definer
set search_path = public
as $$
  select p.id, p.emis, s.name, s.town, s.no_fee, p.title, p.why, p.items, p.supplier, p.price_minor, p.fee_minor, p.fee_bps, p.target_minor, p.currency,
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

drop function public.admin_create_project(text, text, text, text, text, bigint, date);
create function public.admin_create_project(p_emis text, p_title text, p_why text, p_items text,
                                            p_supplier text, p_price_minor bigint, p_deadline date)
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
  insert into public.school_projects (emis, title, why, items, supplier, price_minor, deadline)
  values (p_emis, btrim(p_title), btrim(p_why), btrim(p_items), btrim(p_supplier), p_price_minor, p_deadline)
  returning id into new_id;
  return new_id;
end $$;
revoke execute on function public.admin_create_project(text, text, text, text, text, bigint, date) from public, anon;
grant execute on function public.admin_create_project(text, text, text, text, text, bigint, date) to authenticated;
