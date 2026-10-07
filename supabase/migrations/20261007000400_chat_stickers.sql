-- Rugby stickers in league chat.
--
-- A sticker message stores the sticker's key here and its label in body
-- ("Yellow card"), so quotes, previews and older versions of the app still
-- read sensibly and the existing body rules hold. The app draws the stickers.
alter table public.chat_messages add column if not exists sticker text
  check (sticker is null or sticker ~ '^[a-z_]{2,24}$');
grant insert (sticker) on public.chat_messages to authenticated;
