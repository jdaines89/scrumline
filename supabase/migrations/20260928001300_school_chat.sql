-- Whole-school pools get their own chat too, next to the class chats.
-- Moderation (20260928001200) holds every school and class pool to the full
-- word list, and one report there hides a message for everyone.
create or replace function public.pool_has_chat(p_pool bigint)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.pools where id = p_pool)
$$;
