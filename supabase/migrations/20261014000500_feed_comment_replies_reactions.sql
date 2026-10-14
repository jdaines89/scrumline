-- Feed comments get what chat has: replies (one level, like a thread) and one reaction per player per comment.

alter table public.feed_comments add column reply_to bigint references public.feed_comments(id) on delete set null;
grant insert (reply_to) on public.feed_comments to authenticated;

-- A reply must answer a visible comment on the same post; replying to a reply answers its parent, so threads stay one level.
create or replace function public.feed_reply_ok()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent public.feed_comments;
begin
  if new.reply_to is null then return new; end if;
  select * into parent from public.feed_comments c
   where c.id = new.reply_to and c.project_id = new.project_id and c.post_key = new.post_key and c.hidden_at is null;
  if not found then raise exception 'That comment is no longer there.'; end if;
  new.reply_to := coalesce(parent.reply_to, parent.id);
  return new;
end
$$;
revoke execute on function public.feed_reply_ok() from public, anon, authenticated;

create trigger feed_reply_ok before insert on public.feed_comments
  for each row execute function public.feed_reply_ok();

create table public.feed_comment_reactions (
  comment_id bigint not null references public.feed_comments(id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.members(user_id) on delete cascade,
  emoji      text not null check (emoji in ('👍', '🔥', '🏉', '😢', '😮', '😂')),
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id, emoji)
);
alter table public.feed_comment_reactions enable row level security;
alter table public.feed_comment_reactions force row level security;
revoke all on public.feed_comment_reactions from anon, authenticated;
grant select on public.feed_comment_reactions to authenticated;
grant insert (comment_id, user_id, emoji) on public.feed_comment_reactions to authenticated;
grant delete on public.feed_comment_reactions to authenticated;
create policy "read comment reactions" on public.feed_comment_reactions for select to authenticated using (public.is_member());
create policy "react to a comment as yourself" on public.feed_comment_reactions for insert to authenticated
  with check (user_id = auth.uid() and public.is_member()
              and exists (select 1 from public.feed_comments c where c.id = comment_id and c.hidden_at is null));
create policy "remove your own comment reaction" on public.feed_comment_reactions for delete to authenticated
  using (user_id = auth.uid());

-- One reaction per player per comment: reacting again swaps the earlier one.
create or replace function public.feed_one_comment_reaction()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  delete from public.feed_comment_reactions where comment_id = new.comment_id and user_id = new.user_id and emoji <> new.emoji;
  return new;
end
$$;
create trigger feed_one_comment_reaction before insert on public.feed_comment_reactions
  for each row execute function public.feed_one_comment_reaction();

-- The comments of one post with their replies and reactions, oldest first.
create or replace function public.feed_comments_list(p_project bigint, p_post_key text)
returns table (id bigint, author_id uuid, author_name text, avatar_path text, body text, created_at timestamptz,
               mine boolean, reply_to bigint, reactions jsonb, my_reaction text)
language sql stable
security definer
set search_path = public
as $$
  select c.id, c.author_id, m.display_name, m.avatar_path, c.body, c.created_at, c.author_id = auth.uid(), c.reply_to,
         coalesce((select jsonb_object_agg(r.emoji, r.n) from (select emoji, count(*) n from public.feed_comment_reactions where comment_id = c.id group by emoji) r), '{}'::jsonb),
         (select emoji from public.feed_comment_reactions where comment_id = c.id and user_id = auth.uid() limit 1)
  from public.feed_comments c
  left join public.members m on m.user_id = c.author_id
  where public.is_member() and c.project_id = p_project and c.post_key = p_post_key and c.hidden_at is null
    and not exists (select 1 from public.member_blocks b where b.blocker = auth.uid() and b.blocked = c.author_id)
  order by c.id
  limit 200
$$;
revoke execute on function public.feed_comments_list(bigint, text) from anon, public;
grant execute on function public.feed_comments_list(bigint, text) to authenticated;
