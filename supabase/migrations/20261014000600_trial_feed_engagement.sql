-- Trial projects in the school feed take real comments and reactions from every player.
-- Trial projects are example posts that live only in the app (negative ids, no school_projects row,
-- no money). Their comments and reactions use the same feed tables, with the same moderation, spam
-- limits and one-reaction rule. To remove them all:
--   delete from public.feed_comments where project_id < 0;   -- comment reactions go with them
--   delete from public.feed_reactions where project_id < 0;

-- The project link can no longer be a foreign key (trial ids have no project row). A post is still
-- checked when written (feed_post_ok), and deleting a project still removes its feed rows.
alter table public.feed_comments drop constraint if exists feed_comments_project_id_fkey;
alter table public.feed_reactions drop constraint if exists feed_reactions_project_id_fkey;

create or replace function public.feed_project_gone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.feed_comments where project_id = old.id;
  delete from public.feed_reactions where project_id = old.id;
  return old;
end
$$;
revoke execute on function public.feed_project_gone() from public, anon, authenticated;
create trigger feed_project_gone after delete on public.school_projects
  for each row execute function public.feed_project_gone();

-- A post is a project event: 'opened', 'funded', or 'e<evidence id>'; or one of the fixed trial posts.
create or replace function public.feed_post_ok(p_project bigint, p_post_key text)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select case when p_project < 0
    then (p_project, p_post_key) in ((-11, 'e1'), (-11, 'funded'), (-12, 'e2'), (-12, 'opened'), (-13, 'e3'),
                                      (-14, 'opened'), (-15, 'e5'), (-15, 'funded'))
    else exists (select 1 from public.school_projects p where p.id = p_project and p.status <> 'cancelled')
     and (p_post_key in ('opened', 'funded')
          or (p_post_key ~ '^e[0-9]{1,18}$'
              and exists (select 1 from public.project_evidence e
                          where e.project_id = p_project and e.id = substr(p_post_key, 2)::bigint and e.kind <> 'quote')))
  end
$$;

-- The admin queue also lists held comments on trial posts.
create or replace function public.mod_comment_queue()
returns table (comment_id bigint, school text, project text, author_id uuid, author_name text, body text, held_at timestamptz,
               reasons text, author_removed int)
language plpgsql stable
security definer
set search_path = public, moderation
as $$
begin
  perform moderation.require_admin();
  return query
  select h.comment_id, coalesce(s.name, 'Trial project'), coalesce(p.title, 'Example project'), c.author_id, a.display_name, h.body, h.held_at,
         (select string_agg(distinct r.reason, ', ') from public.feed_comment_reports r where r.comment_id = h.comment_id),
         (select count(*)::int from moderation.removed x where x.author_id = c.author_id and x.removed_at > now() - interval '30 days')
  from moderation.held_comments h
  join public.feed_comments c on c.id = h.comment_id
  left join public.school_projects p on p.id = c.project_id
  left join public.schools s on s.emis = p.emis
  left join public.members a on a.user_id = c.author_id
  where h.decided is null
  order by h.held_at;
end $$;

-- What players have done on the trial posts: reactions, mine, and comment counts.
create or replace function public.feed_trial_state()
returns table (project_id bigint, post_key text, reactions jsonb, mine text[], comments int)
language sql stable
security definer
set search_path = public
as $$
  with posts as (
    select project_id, post_key from public.feed_reactions where project_id < 0
    union
    select project_id, post_key from public.feed_comments where project_id < 0 and hidden_at is null
  )
  select p.project_id, p.post_key,
         coalesce((select jsonb_object_agg(x.emoji, x.n) from (select emoji, count(*) n from public.feed_reactions r
                    where r.project_id = p.project_id and r.post_key = p.post_key group by emoji) x), '{}'::jsonb),
         coalesce((select array_agg(r.emoji) from public.feed_reactions r
                    where r.project_id = p.project_id and r.post_key = p.post_key and r.user_id = auth.uid()), '{}'),
         (select count(*)::int from public.feed_comments c
           where c.project_id = p.project_id and c.post_key = p.post_key and c.hidden_at is null
             and not exists (select 1 from public.member_blocks b where b.blocker = auth.uid() and b.blocked = c.author_id))
  from posts p
  where public.is_member()
$$;
revoke execute on function public.feed_trial_state() from anon, public;
grant execute on function public.feed_trial_state() to authenticated;
