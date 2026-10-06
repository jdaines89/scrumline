-- Replies were added without letting players fill in reply_to, so every reply
-- was refused with "permission denied". The trigger already keeps a reply
-- pointing only at a message in the same league.
grant insert (reply_to) on public.chat_messages to authenticated;
