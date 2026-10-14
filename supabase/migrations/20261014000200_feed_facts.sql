-- Real numbers for the school feed: what each project is, who backed it, and
-- the totals across all schools. Read-only; nothing is stored or changed.

-- Facts about projects that appear in the feed, for signed-in players.
create or replace function public.feed_project_facts(p_projects bigint[])
returns table (project_id bigint, items text, target_minor bigint, pledged_minor bigint, backers int, learners int)
language sql stable
security definer
set search_path = public
as $$
  select p.id, p.items, p.target_minor,
         coalesce((select sum(pl.amount_minor) from public.project_pledges pl where pl.project_id = p.id and pl.status <> 'lapsed'), 0)::bigint,
         (select count(*)::int from public.project_pledges pl where pl.project_id = p.id and pl.status <> 'lapsed'),
         s.learners
  from public.school_projects p
  join public.schools s on s.emis = p.emis
  where public.is_member() and p.status <> 'cancelled' and p.id = any (p_projects[1:60])
$$;
revoke execute on function public.feed_project_facts(bigint[]) from anon, public;
grant execute on function public.feed_project_facts(bigint[]) to authenticated;

-- Across all schools: projects delivered, rands pledged to projects that are fully backed, schools helped.
create or replace function public.feed_totals()
returns table (delivered int, backed_minor bigint, schools int)
language sql stable
security definer
set search_path = public
as $$
  select (select count(*)::int from public.school_projects p where p.status = 'delivered'),
         coalesce((select sum(pl.amount_minor) from public.project_pledges pl
                   join public.school_projects p on p.id = pl.project_id
                   where p.funded_at is not null and p.status <> 'cancelled' and pl.status <> 'lapsed'), 0)::bigint,
         (select count(distinct p.emis)::int from public.school_projects p where p.funded_at is not null and p.status <> 'cancelled')
  where public.is_member()
$$;
revoke execute on function public.feed_totals() from anon, public;
grant execute on function public.feed_totals() to authenticated;
