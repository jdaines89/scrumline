-- "Delete my account" on Profile (POPIA: a player can have their personal
-- information removed).
--
-- The account is anonymised rather than deleted. Deleting the sign-in row
-- would cascade through members into every call and point, and change other
-- players' league tables. Instead everything that identifies the person goes:
-- email, names, picture, schools, alerts, chat text and photos, problem
-- reports, usage events, sign-in. What stays is a nameless "Former player"
-- with their calls and points, so tables don't move for anyone else.
--
-- Kept on purpose (named on the privacy page): money records, which the law
-- requires; and moderation records of removed messages, to keep others safe.
-- Nightly backups roll off within 14 days.
--
-- Accounts tied to a school, a business or money are closed with us instead
-- (Report a problem), because a payout or sponsorship may still be open.
-- Admins can't delete themselves here.
--
-- Returns the storage paths of the player's picture and chat photos, which the
-- app then removes with the player's own storage rights.

create or replace function public.delete_my_account(p_confirm text)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  tag text;
  gone text;
  files text[];
  old_email text;
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if p_confirm is distinct from 'DELETE' then
    raise exception 'Type DELETE to confirm.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.members where user_id = me) then
    raise exception 'There''s no player account to delete.' using errcode = '22023';
  end if;
  if exists (select 1 from public.members where user_id = me and is_admin) then
    raise exception 'Admins can''t delete their own account here.' using errcode = '42501';
  end if;
  if exists (select 1 from public.business_accounts where user_id = me)
     or exists (select 1 from public.school_accounts where user_id = me)
     or exists (select 1 from public.school_claims where user_id = me)
     or exists (select 1 from public.sponsor_managers where user_id = me)
     or exists (select 1 from public.project_pledges where user_id = me) then
    raise exception 'Your account is linked to a school, a business or a payment. Use Report a problem and we''ll close it with you.'
      using errcode = '22023';
  end if;

  tag := upper(left(replace(me::text, '-', ''), 6));
  gone := 'deleted-' || replace(me::text, '-', '') || '@deleted.invalid';
  select email into old_email from public.members where user_id = me;

  -- Files for the app to remove afterwards.
  select coalesce(array_agg(p), '{}') into files from (
    select 'avatars/' || avatar_path as p from public.members where user_id = me and avatar_path is not null
    union all
    select 'chat-photos/' || image_path from public.chat_messages where author_id = me and image_path is not null
  ) f;

  -- The player: nameless from here on. first_name null keeps the naming
  -- trigger from rebuilding a display name.
  update public.members
     set email = gone,
         first_name = null, last_name = null, known_as = null,
         display_name = 'Former player ' || tag,
         team_name = 'Former player ' || tag,
         avatar_path = null,
         email_reminders = false, push_mentions = false, push_results = false
   where user_id = me;

  -- What they wrote and shared.
  update public.chat_messages
     set body = 'Message deleted', image_path = null, sticker = null
   where author_id = me;
  update public.prize_messages set body = 'Message deleted' where author_id = me;
  delete from public.chat_reactions where user_id = me;
  delete from public.chat_poll_votes where user_id = me;
  delete from public.chat_mentions where user_id = me;
  delete from public.chat_reads where user_id = me;
  delete from public.chat_reports where reporter = me;

  -- Schools, alerts, invites, reports, usage.
  delete from public.member_schools where user_id = me;
  delete from public.school_vouches where member_id = me or voucher_id = me;
  delete from public.push_subscriptions where user_id = me;
  delete from notify.push_outbox where user_id = me;
  delete from public.invite_codes where user_id = me;
  update public.invites set email = gone where invitee_id = me;
  delete from public.problem_reports where user_id = me;
  delete from analytics.events where user_id = me;
  delete from public.activity where user_id = me;
  delete from notify.login_codes where lower(email) = lower(old_email);

  -- Sign-in: no email, no password, signed out everywhere.
  update auth.users
     set email = gone, encrypted_password = '', raw_user_meta_data = '{}'::jsonb
   where id = me;
  if exists (select 1 from information_schema.columns
             where table_schema = 'auth' and table_name = 'users' and column_name = 'banned_until') then
    execute 'update auth.users set banned_until = ''infinity'', phone = null, email_change = '''' where id = $1' using me;
  end if;
  if to_regclass('auth.identities') is not null then
    execute 'delete from auth.identities where user_id = $1' using me;
  end if;
  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1' using me;
  end if;
  if to_regclass('auth.refresh_tokens') is not null then
    execute 'delete from auth.refresh_tokens where user_id = $1::text' using me;
  end if;
  if to_regclass('auth.one_time_tokens') is not null then
    execute 'delete from auth.one_time_tokens where user_id = $1' using me;
  end if;

  return files;
end $$;

revoke execute on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated;
