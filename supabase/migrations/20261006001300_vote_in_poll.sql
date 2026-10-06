-- Voting in a poll goes through one function that only ever sets your own
-- answer. The app's upsert also rewrote the poll id, which players aren't
-- allowed to change, so every vote came back "permission denied".
--
-- Additive only.

create or replace function public.vote_in_poll(p_message bigint, p_choice smallint)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.chat_poll_votes (message_id, user_id, choice)
  values (p_message, auth.uid(), p_choice)
  on conflict (message_id, user_id) do update set choice = excluded.choice;
$$;
revoke execute on function public.vote_in_poll(bigint, smallint) from anon, public;
grant execute on function public.vote_in_poll(bigint, smallint) to authenticated;
