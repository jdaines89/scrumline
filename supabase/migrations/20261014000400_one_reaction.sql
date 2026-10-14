-- One reaction per player per post: reacting again swaps the earlier one.
create or replace function public.feed_one_reaction()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  delete from public.feed_reactions
  where project_id = new.project_id and post_key = new.post_key and user_id = new.user_id and emoji <> new.emoji;
  return new;
end
$$;

create trigger feed_one_reaction before insert on public.feed_reactions
  for each row execute function public.feed_one_reaction();
