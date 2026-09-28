-- How a player wants kickoff reminders: by push on their phone (the
-- default, falling back to email when they have no phone set up) or always
-- by email. Turning reminders off stays members.email_reminders.
alter table public.members add column reminder_by text not null default 'push'
  check (reminder_by in ('push', 'email'));
grant update (reminder_by) on public.members to authenticated;

create or replace function notify.send_reminders()
returns int
language plpgsql
security definer
set search_path = public, notify
as $$
declare
  key text;
  d record;
  rid bigint;
  n int := 0;
  pushed int := 0;
  cfg jsonb := (select jsonb_object_agg(s.key, s.value) from notify.settings s);
  push_on boolean := exists (select 1 from notify.settings s where s.key = 'vapid_public_key');
begin
  select decrypted_secret into key from vault.decrypted_secrets where name = 'brevo_api_key';
  for d in select * from notify.due_reminders() loop
    rid := null;
    if push_on
       and exists (select 1 from public.members mb where mb.user_id = d.user_id and mb.reminder_by = 'push')
       and exists (select 1 from public.push_subscriptions ps where ps.user_id = d.user_id) then
      insert into notify.push_outbox (user_id, title, body, url, tag)
      values (d.user_id,
              case when cardinality(d.match_ids) = 1 then 'Kickoff in under an hour'
                   else 'Kickoff in under an hour: ' || cardinality(d.match_ids) || ' scores to call' end,
              'You haven''t called ' || array_to_string(d.lines, ', ') || '. It locks at kickoff.',
              cfg ->> 'app_url',
              'kickoff');
      pushed := pushed + 1;
    elsif key is not null then
      rid := net.http_post(
        url := 'https://api.brevo.com/v3/smtp/email',
        headers := jsonb_build_object('api-key', key, 'content-type', 'application/json', 'accept', 'application/json'),
        body := jsonb_build_object(
          'sender', jsonb_build_object('email', cfg ->> 'sender_email', 'name', cfg ->> 'sender_name'),
          'to', jsonb_build_array(jsonb_build_object('email', d.email, 'name', d.display_name)),
          'subject', case when cardinality(d.match_ids) = 1 then 'Kickoff in under an hour: call your score'
                          else 'Kickoff in under an hour: ' || cardinality(d.match_ids) || ' scores to call' end,
          'htmlContent',
            '<p>Hi ' || replace(replace(replace(d.display_name, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || ',</p>'
            || '<p>You haven''t called a score for:</p><ul><li>'
            || array_to_string(d.lines, '</li><li>')
            || '</li></ul><p>Times are SA time. <a href="' || (cfg ->> 'app_url') || '">Call it now</a> before it locks at kickoff.</p>'
            || '<p style="color:#888;font-size:12px">You can turn these off, or switch them to your phone, on your profile.</p>'
        )
      );
    else
      continue;
    end if;
    insert into notify.reminders_sent (user_id, match_id, request_id)
    select d.user_id, x, rid from unnest(d.match_ids) x
    on conflict do nothing;
    n := n + 1;
  end loop;
  if pushed > 0 then perform notify.kick_push(); end if;
  return n;
end;
$$;
revoke all on function notify.send_reminders() from public, anon, authenticated;
