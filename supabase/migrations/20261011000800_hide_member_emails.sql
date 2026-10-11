-- Players could read every other player's email address: members is readable
-- by any player (members read: is_member()), all columns. Email now belongs to
-- its owner only; the app takes your own from your session.
--
-- Column grants: a column added to members later is NOT readable by players
-- until it's added to this list (and to MEMBER_COLS in src/lib/types.ts).
-- Writes are unchanged: players keep their existing update rights.
revoke select on public.members from anon, authenticated;
grant select (user_id, display_name, is_admin, joined_at, email_reminders, avatar_path, push_mentions,
              reminder_by, first_name, last_name, known_as, team_name, school_asked_at, push_results)
  on public.members to authenticated;
