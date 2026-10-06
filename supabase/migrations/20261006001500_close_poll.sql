-- Whoever asked a poll can close it: the results freeze and nobody can vote
-- or change their vote after that. Closing can't be undone.
--
-- Additive only.

alter table public.chat_polls add column if not exists closed_at timestamptz;

-- Votes stop once a poll is closed (the rest is as before).
create or replace function public.check_poll_vote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select closed_at from public.chat_polls where message_id = new.message_id) is not null then
    raise exception 'This poll is closed.' using errcode = '22023';
  end if;
  if new.choice >= (select cardinality(options) from public.chat_polls where message_id = new.message_id) then
    raise exception 'That isn''t one of the answers.' using errcode = '22023';
  end if;
  new.voted_at := now();
  return new;
end $$;

-- Players have no update rights on polls, so closing goes through here,
-- and only for the person who asked the question.
create or replace function public.close_poll(p_message bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.chat_messages c where c.id = p_message and c.author_id = auth.uid()) then
    raise exception 'Only the person who asked can close this poll.' using errcode = '42501';
  end if;
  update public.chat_polls set closed_at = now() where message_id = p_message and closed_at is null;
end $$;
revoke execute on function public.close_poll(bigint) from anon, public;
grant execute on function public.close_poll(bigint) to authenticated;
