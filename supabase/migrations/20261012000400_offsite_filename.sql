-- Brevo refuses attachments it does not recognise ("Unsupported file format: pgp"),
-- so tonight's file is named .pgp.txt. The content is unchanged: it is still the
-- encrypted OpenPGP message, and gpg opens it whatever the name:
--   gpg --decrypt scrumline-backup-YYYY-MM-DD.pgp.txt
-- Additive only.
create or replace function backup.offsite_payload()
returns table (file_name text, body text, tables integer, total_rows bigint)
language plpgsql
security definer
set search_path = extensions, public, pg_temp
as $$
declare
  pass text;
  s smallint;
  j jsonb;
begin
  select decrypted_secret into pass from vault.decrypted_secrets where name = 'backup_passphrase';
  if pass is null or length(pass) < 16 then return; end if;
  select x.slot into s from backup.snapshots x order by x.taken_at desc limit 1;
  if s is null then return; end if;
  select jsonb_object_agg(x.tbl, x.rows), count(*), coalesce(sum(x.row_count), 0)
    into j, tables, total_rows from backup.snapshots x where x.slot = s;
  file_name := 'scrumline-backup-' || to_char(now() at time zone 'Africa/Johannesburg', 'YYYY-MM-DD') || '.pgp.txt';
  body := replace(encode(pgp_sym_encrypt(j::text, pass, 'compress-algo=2, cipher-algo=aes256'), 'base64'), E'\n', '');
  return next;
end $$;
revoke all on function backup.offsite_payload() from public, anon, authenticated;
