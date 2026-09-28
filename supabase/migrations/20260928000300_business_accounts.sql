-- Business accounts: a business signs itself up to sponsor a school, with no
-- invite from us. Its account can find schools and book slots, and nothing
-- else: it has no members row, so every player table, pool, chat and email
-- address stays closed to it under the policies that already exist.
--
-- Public sign-up stays off. The business-signup Edge Function creates the
-- account as service role, with user metadata kind = 'business', and emails
-- the business its own link.

create table public.business_accounts (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  business_name text not null check (length(btrim(business_name)) between 2 and 60),
  created_at    timestamptz not null default now()
);
alter table public.business_accounts enable row level security;
create policy "yours" on public.business_accounts for select to authenticated using (user_id = auth.uid());
revoke all on public.business_accounts from anon;
revoke insert, update, delete on public.business_accounts from authenticated;

-- Who asked for a sign-up link, so one address or one connection can't send
-- a stream of emails. Only the Edge Function (service role) touches it.
create table public.business_signups (
  id         bigint generated always as identity primary key,
  email      text not null,
  ip         text,
  at         timestamptz not null default now()
);
create index business_signups_email on public.business_signups (email, at);
create index business_signups_ip on public.business_signups (ip, at);
alter table public.business_signups enable row level security;
revoke all on public.business_signups from anon, authenticated;

create or replace function public.is_business()
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.business_accounts where user_id = auth.uid())
$$;
revoke execute on function public.is_business() from public, anon;
grant execute on function public.is_business() to authenticated;

-- Invited accounts become members, as before; accounts the sign-up function
-- made for a business become business accounts instead.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.invited_at is null then
    return new;
  end if;
  if new.raw_user_meta_data ->> 'kind' = 'business' then
    insert into public.business_accounts (user_id, business_name)
    values (new.id, left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'business_name'), ''), split_part(new.email, '@', 1)), 60))
    on conflict (user_id) do nothing;
    return new;
  end if;
  insert into public.members (user_id, email, display_name)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from anon, authenticated, public;

-- What a business needs to pick a slot: the schools and the tournaments.
create policy "businesses read" on public.schools for select to authenticated using (public.is_business());
create policy "businesses read" on public.seasons for select to authenticated using (public.is_business());
create policy "businesses read" on public.competitions for select to authenticated using (public.is_business());

-- The sign-up email: a link to choose a password (new business) or to sign
-- straight in (the address already has an account). Sent through Brevo like
-- every other email; only the Edge Function may call it.
create or replace function public.send_business_link(p_email text, p_name text, p_link text, p_existing boolean)
returns bigint
language plpgsql
security definer
set search_path = public, notify
as $$
declare
  key text;
  cfg jsonb := (select jsonb_object_agg(s.key, s.value) from notify.settings s);
  who text := replace(replace(replace(coalesce(p_name, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  link text := replace(replace(p_link, '"', '%22'), '<', '%3C');
begin
  select decrypted_secret into key from vault.decrypted_secrets where name = 'brevo_api_key';
  if key is null then raise exception 'Email is not set up'; end if;
  return net.http_post(
    url := 'https://api.brevo.com/v3/smtp/email',
    headers := jsonb_build_object('api-key', key, 'content-type', 'application/json', 'accept', 'application/json'),
    body := jsonb_build_object(
      'sender', jsonb_build_object('email', cfg ->> 'sender_email', 'name', cfg ->> 'sender_name'),
      'to', jsonb_build_array(jsonb_build_object('email', p_email)),
      'subject', case when p_existing then 'Sign in to Scrumline' else 'Set up your Scrumline business account' end,
      'htmlContent',
        case when p_existing then
          '<p>You already have a Scrumline account with this address. Use the link below to sign in, then open Sponsor a school.</p>'
        else
          '<p>Thanks for signing ' || case when who = '' then 'up' else who || ' up' end || ' to back a school on Scrumline.</p>'
          || '<p>Choose a password with the link below. You can then find a school, see what is open and book it.</p>'
        end
        || '<p><a href="' || link || '">' || case when p_existing then 'Sign in' else 'Choose a password' end || '</a></p>'
        || '<p style="color:#667">The link works once, for 24 hours. If you did not ask for this, ignore this email.</p>'
    )
  );
end $$;
revoke execute on function public.send_business_link(text, text, text, boolean) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.send_business_link(text, text, text, boolean) to service_role;
  end if;
end $$;
