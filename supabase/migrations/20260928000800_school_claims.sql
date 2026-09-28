-- Schools take part: a principal, bursar, governing body member or alumni
-- office claims its school, gives the school's bank account, and from then
-- on sees what it has raised, is paid monthly and confirms each payment.
--
-- Trust without paperwork:
--   * The name on the bank account must match the school's official name
--     (school_name_matches), and Paystack must confirm the account is held
--     under that name and open for payments. Both true: verified at once.
--     Anything else waits for an admin (review_school_claim).
--   * A verified claim is on notice for 7 days: every player who saved the
--     school sees who claimed it and can flag it. A flag stops payouts until
--     an admin looks. Payouts start only after the notice.
--   * Only the last 4 digits of the account are kept. Paystack holds the full
--     number behind a transfer recipient code.
--
-- Schools that can't or won't do this online (most no-fee schools, many in
-- rural areas) are looked after by a person instead: an admin records an
-- assisted claim with the contact's name, phone and language, and the school
-- takes its money by EFT or as goods the Foundation buys for it. The admin
-- records delivery and the school's confirmation (a WhatsApp message, a photo).
--
-- Money that nobody claims for 12 months goes to the school's partner no-fee
-- school (or the schools fund), so it never sits still.

-- 1. School accounts ------------------------------------------------------------
create table public.school_accounts (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  contact_name text not null check (length(btrim(contact_name)) between 2 and 60),
  role         text not null check (role in ('principal', 'bursar', 'sgb', 'alumni')),
  emis         text references public.schools(emis),
  created_at   timestamptz not null default now()
);
alter table public.school_accounts enable row level security;
create policy "yours" on public.school_accounts for select to authenticated using (user_id = auth.uid());
revoke all on public.school_accounts from anon;
revoke insert, update, delete on public.school_accounts from authenticated;

create or replace function public.is_school_account()
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.school_accounts where user_id = auth.uid())
$$;
revoke execute on function public.is_school_account() from public, anon;
grant execute on function public.is_school_account() to authenticated;

-- A school contact finds its school in the government list.
create policy "school accounts read" on public.schools for select to authenticated using (public.is_school_account());

-- Accounts the sign-up function made for a school become school accounts.
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
  if new.raw_user_meta_data ->> 'kind' = 'school' then
    insert into public.school_accounts (user_id, contact_name, role)
    values (new.id,
            left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'contact_name'), ''), split_part(new.email, '@', 1)), 60),
            case when new.raw_user_meta_data ->> 'role' in ('principal', 'bursar', 'sgb', 'alumni')
                 then new.raw_user_meta_data ->> 'role' else 'sgb' end)
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

-- A player who also runs their school's account signs up with the address
-- they play with; the sign-up function adds the school side to it.
create or replace function public.add_school_account(p_user uuid, p_contact text, p_role text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.school_accounts (user_id, contact_name, role)
  values (p_user, left(btrim(p_contact), 60), case when p_role in ('principal', 'bursar', 'sgb', 'alumni') then p_role else 'sgb' end)
  on conflict (user_id) do nothing
$$;

-- Pick the school, until it has a claim.
create or replace function public.set_school_account_school(p_emis text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_school_account() then raise exception 'Not a school account' using errcode = '42501'; end if;
  if not exists (select 1 from public.schools where emis = p_emis) then raise exception 'No such school' using errcode = '22023'; end if;
  if exists (select 1 from public.school_claims c where c.user_id = auth.uid() and c.status in ('needs_review', 'verified')) then
    raise exception 'Your claim is in. Ask us to change the school.' using errcode = 'P0001';
  end if;
  update public.school_accounts set emis = p_emis where user_id = auth.uid();
end $$;

-- 2. Claims ----------------------------------------------------------------------
create table public.school_claims (
  id             bigint generated always as identity primary key,
  emis           text not null references public.schools(emis),
  user_id        uuid references auth.users(id) on delete cascade,
  status         text not null check (status in ('needs_review', 'verified', 'rejected', 'revoked')),
  payout_mode    text not null default 'transfer' check (payout_mode in ('transfer', 'goods')),
  bank_name      text,
  account_last4  text check (account_last4 ~ '^\d{4}$'),
  account_name   text check (length(btrim(account_name)) between 2 and 100),
  name_matches   boolean,
  bank_confirmed boolean,
  recipient_code text,
  -- Assisted claims: no app account at the school; a person looks after it.
  assisted_by    uuid references public.members(user_id),
  contact_name   text check (length(btrim(contact_name)) between 2 and 60),
  contact_role   text check (contact_role in ('principal', 'bursar', 'sgb', 'alumni', 'teacher')),
  contact_phone  text check (contact_phone ~ '^\+?[0-9 ]{9,16}$'),
  language       text check (language in ('en', 'af', 'xh', 'zu', 'st', 'tn', 'nso', 've', 'ts', 'ss', 'nr')),
  review_reason  text,
  created_at     timestamptz not null default now(),
  verified_at    timestamptz,
  notice_until   timestamptz,
  check ((user_id is null) <> (assisted_by is null)),
  check (assisted_by is null or (contact_name is not null and contact_phone is not null)),
  check (payout_mode = 'goods' or recipient_code is not null)
);
-- One live claim per school.
create unique index school_claims_live on public.school_claims (emis) where status in ('needs_review', 'verified');
alter table public.school_claims enable row level security;
create policy "yours" on public.school_claims for select to authenticated using (user_id = auth.uid());
revoke all on public.school_claims from anon;
revoke insert, update, delete on public.school_claims from authenticated;

create table public.school_claim_flags (
  claim_id  bigint not null references public.school_claims(id) on delete cascade,
  user_id   uuid not null references public.members(user_id) on delete cascade,
  reason    text not null check (length(btrim(reason)) between 3 and 200),
  at        timestamptz not null default now(),
  primary key (claim_id, user_id)
);
alter table public.school_claim_flags enable row level security;
revoke all on public.school_claim_flags from anon, authenticated;

-- Does the name on the account belong to this school? Every telling word of
-- the school's name (or of one of its known names) must be in the account
-- name. Words every school shares (school, high, primary, SGB, trust...)
-- don't count, so "Paul Roos Gimnasium SGB" matches Paul Roos Gimnasium and
-- "PRG Trust" goes to a person.
create or replace function public.school_name_words(p text)
returns text[]
language sql immutable
set search_path = public
as $$
  select coalesce(array_agg(w), '{}')
  from regexp_split_to_table(public.school_key(p), ' ') w
  where length(w) >= 2 and w not in (
    'school', 'skool', 'schools', 'hoerskool', 'laerskool', 'hoer', 'laer', 'high', 'primary', 'primere', 'secondary',
    'sekondere', 'combined', 'gekombineerde', 'junior', 'senior', 'intermediate', 'middle', 'technical', 'tegniese',
    'the', 'die', 'of', 'van', 'and', 'en', 'sgb', 'governing', 'body', 'beheerliggaam', 'trust', 'fund', 'fonds',
    'account', 'rekening', 'current', 'cheque', 'public', 'openbare', 'ps', 'ss', 'hs', 'lsk', 'hsk', 'pty', 'ltd', 'npc')
$$;

create or replace function public.school_name_matches(p_account_name text, p_emis text)
returns boolean
language sql stable
set search_path = public
as $$
  select exists (
    select 1
    from public.schools s, unnest(array[s.name] || s.aka) n
    where s.emis = p_emis
      and cardinality(public.school_name_words(n)) > 0
      and public.school_name_words(n) <@ public.school_name_words(p_account_name)
  )
$$;

-- The bank check (school-bank Edge Function) records its result here.
create or replace function public.record_school_claim(p_user uuid, p_bank_name text, p_last4 text, p_account_name text,
                                                      p_bank_confirmed boolean, p_recipient text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.school_accounts;
  ok boolean;
begin
  select * into a from public.school_accounts where user_id = p_user;
  if a.user_id is null or a.emis is null then return 'pick your school first'; end if;
  if exists (select 1 from public.school_claims where emis = a.emis and status in ('needs_review', 'verified')) then
    return case when exists (select 1 from public.school_claims where emis = a.emis and user_id = p_user and status in ('needs_review', 'verified'))
                then 'already claimed by you' else 'already claimed' end;
  end if;
  ok := public.school_name_matches(p_account_name, a.emis);
  insert into public.school_claims (emis, user_id, status, bank_name, account_last4, account_name, name_matches, bank_confirmed,
                                    recipient_code, review_reason, verified_at, notice_until)
  values (a.emis, p_user, case when ok and p_bank_confirmed then 'verified' else 'needs_review' end,
          p_bank_name, p_last4, btrim(p_account_name), ok, p_bank_confirmed, p_recipient,
          case when not ok then 'The name on the account doesn''t match the school''s name'
               when not p_bank_confirmed then 'The bank didn''t confirm the account holder' end,
          case when ok and p_bank_confirmed then now() end,
          case when ok and p_bank_confirmed then now() + interval '7 days' end);
  return case when ok and p_bank_confirmed then 'verified' else 'needs_review' end;
end $$;

-- An admin approves or turns down a claim that needs a look (or was flagged).
create or replace function public.review_school_claim(p_claim bigint, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_caller() then raise exception 'Admins only' using errcode = '42501'; end if;
  update public.school_claims
  set status = case when p_approve then 'verified' else 'rejected' end,
      review_reason = coalesce(p_note, review_reason),
      verified_at = case when p_approve then now() end,
      notice_until = case when p_approve then greatest(coalesce(notice_until, now()), now()) end
  where id = p_claim and status in ('needs_review', 'verified');
  if not found then raise exception 'No claim to review' using errcode = 'P0001'; end if;
  if p_approve then delete from public.school_claim_flags where claim_id = p_claim; end if;
end $$;

-- A player from the school says the claim isn't right: payouts stop until an admin looks.
create or replace function public.flag_school_claim(p_claim bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.school_claims;
begin
  select * into c from public.school_claims where id = p_claim for update;
  if c.id is null or c.status not in ('verified', 'needs_review')
     or not exists (select 1 from public.member_schools where user_id = auth.uid() and emis = c.emis) then
    raise exception 'You can only flag a claim for your own school' using errcode = '42501';
  end if;
  insert into public.school_claim_flags (claim_id, user_id, reason) values (p_claim, auth.uid(), btrim(p_reason))
  on conflict (claim_id, user_id) do update set reason = excluded.reason, at = now();
  update public.school_claims set status = 'needs_review', review_reason = 'Flagged by a player from the school'
  where id = p_claim;
end $$;

-- Who claimed my school, for players who saved it.
create or replace function public.school_claim_info(p_emis text)
returns table (claim_id bigint, contact_name text, role text, status text, verified_at timestamptz,
               notice_until timestamptz, flagged_by_me boolean)
language sql stable
security definer
set search_path = public
as $$
  select c.id, coalesce(a.contact_name, c.contact_name), coalesce(a.role, c.contact_role), c.status, c.verified_at, c.notice_until,
         exists (select 1 from public.school_claim_flags f where f.claim_id = c.id and f.user_id = auth.uid())
  from public.school_claims c left join public.school_accounts a on a.user_id = c.user_id
  where c.emis = p_emis and c.status in ('needs_review', 'verified')
    and exists (select 1 from public.member_schools ms where ms.user_id = auth.uid() and ms.emis = p_emis)
$$;

-- 3. Payouts ----------------------------------------------------------------------
create table public.school_payouts (
  id            bigint generated always as identity primary key,
  emis          text not null references public.schools(emis),
  claim_id      bigint not null references public.school_claims(id),
  amount_minor  bigint not null check (amount_minor > 0),
  currency      text not null,
  status        text not null default 'pending' check (status in ('pending', 'sent', 'paid', 'failed', 'confirmed')),
  reference     text unique,
  transfer_code text,
  failure       text,
  -- Goods, or how an assisted school confirmed ("WhatsApp photo from the principal").
  note          text check (length(note) <= 300),
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  paid_at       timestamptz,
  confirmed_at  timestamptz
);
create index school_payouts_school on public.school_payouts (emis, created_at desc);
alter table public.school_payouts enable row level security;
create policy "your school" on public.school_payouts for select to authenticated
  using (exists (select 1 from public.school_claims c where c.id = claim_id and c.user_id = auth.uid()));
revoke all on public.school_payouts from anon;
revoke insert, update, delete on public.school_payouts from authenticated;

alter table public.school_allocations
  add column payout_id bigint references public.school_payouts(id),
  add column original_emis text references public.schools(emis);
create index school_allocations_payout on public.school_allocations (payout_id);

-- Monthly: one payout per claimed school, of every share that is due, once
-- the claim is past its notice and the sponsorship was paid at least 7 days
-- ago (time to sort out a refund). Small amounts wait for the next month.
create or replace function public.make_school_payouts(p_min_minor bigint default 10000)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int := 0;
  r record;
  pid bigint;
begin
  if not public.is_admin_caller() then raise exception 'Admins only' using errcode = '42501'; end if;
  for r in
    select c.id as claim_id, c.emis, a.currency, sum(a.amount_minor)::bigint as total, array_agg(a.id) as ids
    from public.school_claims c
    join public.school_allocations a on a.emis = c.emis and a.status = 'due' and a.payout_id is null
    join public.sponsor_bookings b on b.id = a.booking_id and b.status in ('paid', 'live', 'ended') and b.paid_at <= now() - interval '7 days'
    where c.status = 'verified' and c.notice_until <= now()
    group by c.id, c.emis, a.currency
    having sum(a.amount_minor) >= p_min_minor
  loop
    insert into public.school_payouts (emis, claim_id, amount_minor, currency)
    values (r.emis, r.claim_id, r.total, r.currency) returning id into pid;
    update public.school_payouts set reference = 'slp-' || pid || '-' || to_char(now(), 'YYYYMM') where id = pid;
    update public.school_allocations set payout_id = pid where id = any (r.ids);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Sending: each pending payout goes to Paystack as a transfer. Needs the
-- Paystack secret key in Vault as 'paystack_secret_key'; without it nothing
-- is sent and payouts wait. Paystack's answer arrives at the webhook.
create or replace function public.send_school_payouts()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  key text;
  p record;
  n int := 0;
begin
  if not public.is_admin_caller() then raise exception 'Admins only' using errcode = '42501'; end if;
  select decrypted_secret into key from vault.decrypted_secrets where name = 'paystack_secret_key';
  if key is null then return 0; end if;
  for p in
    select sp.*, c.recipient_code, s.name
    from public.school_payouts sp
    join public.school_claims c on c.id = sp.claim_id and c.status = 'verified'
    join public.schools s on s.emis = sp.emis
    where sp.status = 'pending' and c.payout_mode = 'transfer'
    for update of sp
  loop
    perform net.http_post(
      url := 'https://api.paystack.co/transfer',
      headers := jsonb_build_object('Authorization', 'Bearer ' || key, 'Content-Type', 'application/json'),
      body := jsonb_build_object('source', 'balance', 'amount', p.amount_minor, 'currency', p.currency,
                                 'recipient', p.recipient_code, 'reference', p.reference,
                                 'reason', left('Scrumline sponsors for ' || p.name, 100)));
    update public.school_payouts set status = 'sent', sent_at = now() where id = p.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- The webhook reports how a transfer ended.
create or replace function public.school_payout_result(p_reference text, p_ok boolean, p_transfer_code text, p_failure text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.school_payouts;
begin
  select * into p from public.school_payouts where reference = p_reference for update;
  if p.id is null then return 'no such payout'; end if;
  if p.status in ('paid', 'confirmed') then return 'already paid'; end if;
  if p_ok then
    update public.school_payouts set status = 'paid', paid_at = now(), transfer_code = p_transfer_code, failure = null where id = p.id;
    update public.school_allocations set status = 'paid', paid_at = now(), reference = p_reference where payout_id = p.id;
    return 'ok';
  end if;
  -- Failed or reversed: the shares go back to due for next month's payout.
  update public.school_payouts set status = 'failed', transfer_code = p_transfer_code, failure = left(p_failure, 200) where id = p.id;
  update public.school_allocations set payout_id = null where payout_id = p.id;
  return 'failed';
end $$;

-- The school says the money arrived.
create or replace function public.confirm_school_payout(p_payout bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.school_payouts;
begin
  select * into p from public.school_payouts where id = p_payout for update;
  if p.id is null or not exists (select 1 from public.school_claims c where c.id = p.claim_id and c.user_id = auth.uid()) then
    raise exception 'Not your school''s payment' using errcode = '42501';
  end if;
  if p.status <> 'paid' then raise exception 'This payment hasn''t arrived yet' using errcode = 'P0001'; end if;
  update public.school_payouts set status = 'confirmed', confirmed_at = now() where id = p.id;
  update public.school_allocations set status = 'confirmed', confirmed_at = now() where payout_id = p.id;
end $$;

-- A year with nobody claiming it: the share moves to the school's partner
-- no-fee school, or to the schools fund when there is none (or the school is
-- no-fee itself). original_emis keeps where it started.
create or replace function public.redirect_unclaimed_shares()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if not public.is_admin_caller() then raise exception 'Admins only' using errcode = '42501'; end if;
  update public.school_allocations a
  set original_emis = a.emis,
      emis = (select p.partner_emis from public.school_partners p join public.schools s on s.emis = a.emis
              where p.emis = a.emis and not s.no_fee)
  from public.sponsor_bookings b
  where b.id = a.booking_id and a.status = 'due' and a.payout_id is null and a.original_emis is null
    and a.emis is not null and b.paid_at < now() - interval '12 months'
    and not exists (select 1 from public.school_claims c where c.emis = a.emis and c.status in ('verified', 'needs_review'));
  get diagnostics n = row_count;
  return n;
end $$;

-- 4. The school's page ----------------------------------------------------------------
create or replace function public.school_dashboard()
returns table (emis text, name text, town text, no_fee boolean, partner_name text, partner_town text,
               players int, raised_minor bigint, paid_minor bigint, confirmed_minor bigint, waiting_minor bigint,
               sponsors text[], claim_status text, review_reason text, notice_until timestamptz,
               bank_name text, account_last4 text, account_name text)
language sql stable
security definer
set search_path = public
as $$
  with me as (select * from public.school_accounts where user_id = auth.uid()),
  c as (select * from public.school_claims x where x.user_id = auth.uid() and x.emis = (select emis from me)
        order by (x.status in ('verified', 'needs_review')) desc, x.created_at desc limit 1),
  money as (
    select a.amount_minor, a.status, coalesce(cr.display_name, sp.name) as sponsor
    from public.school_allocations a
    join public.sponsor_bookings b on b.id = a.booking_id and b.status in ('paid', 'live', 'ended')
    join public.sponsors sp on sp.id = b.sponsor_id and not sp.blocked
    left join public.sponsor_creatives cr on cr.booking_id = b.id and cr.status = 'approved'
    where a.emis = (select emis from me) and a.currency = 'ZAR'
  )
  select s.emis, s.name, s.town, s.no_fee, ps.name, ps.town,
         (select count(distinct ms.user_id) from public.member_schools ms where ms.emis = s.emis)::int,
         coalesce((select sum(amount_minor) from money), 0)::bigint,
         coalesce((select sum(amount_minor) from money where status in ('paid', 'confirmed')), 0)::bigint,
         coalesce((select sum(amount_minor) from money where status = 'confirmed'), 0)::bigint,
         coalesce((select sum(amount_minor) from money where status = 'due'), 0)::bigint,
         coalesce((select array_agg(distinct sponsor order by sponsor) from money), '{}'),
         c.status, c.review_reason, c.notice_until, c.bank_name, c.account_last4, c.account_name
  from me join public.schools s on s.emis = me.emis
  left join public.school_partners p on p.emis = s.emis
  left join public.schools ps on ps.emis = p.partner_emis
  left join c on true
$$;

-- 5. Schools looked after by a person ----------------------------------------------------
-- An assisted claim: the admin has spoken to the school. It is verified at
-- once and still goes on notice, so players from the school can flag it.
create or replace function public.record_assisted_claim(p_admin uuid, p_emis text, p_contact text, p_role text, p_phone text,
                                                        p_language text, p_mode text, p_bank_name text default null,
                                                        p_last4 text default null, p_account_name text default null,
                                                        p_recipient text default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  id bigint;
begin
  if not exists (select 1 from public.members where user_id = p_admin and is_admin) then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if exists (select 1 from public.school_claims where emis = p_emis and status in ('needs_review', 'verified')) then
    raise exception 'This school is already claimed' using errcode = 'P0001';
  end if;
  insert into public.school_claims (emis, status, payout_mode, bank_name, account_last4, account_name, name_matches, bank_confirmed,
                                    recipient_code, assisted_by, contact_name, contact_role, contact_phone, language,
                                    verified_at, notice_until)
  values (p_emis, 'verified', p_mode, p_bank_name, p_last4, btrim(p_account_name),
          case when p_account_name is not null then public.school_name_matches(p_account_name, p_emis) end,
          case when p_recipient is not null then true end, p_recipient, p_admin, btrim(p_contact), p_role,
          regexp_replace(btrim(p_phone), '\s+', ' ', 'g'), p_language, now(), now() + interval '7 days')
  returning school_claims.id into id;
  return id;
end $$;

-- Goods need no bank account, so an admin records those claims from the app.
create or replace function public.assisted_goods_claim(p_emis text, p_contact text, p_role text, p_phone text, p_language text)
returns bigint
language sql
security definer
set search_path = public
as $$
  select public.record_assisted_claim(auth.uid(), p_emis, p_contact, p_role, p_phone, p_language, 'goods')
$$;

-- Goods bought and delivered for a payout: what, and when.
create or replace function public.record_goods_delivered(p_payout bigint, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_caller() then raise exception 'Admins only' using errcode = '42501'; end if;
  if coalesce(length(btrim(p_note)), 0) < 3 then raise exception 'Say what was delivered' using errcode = '22023'; end if;
  update public.school_payouts sp set status = 'paid', paid_at = now(), note = left(btrim(p_note), 300)
  from public.school_claims c
  where sp.id = p_payout and c.id = sp.claim_id and c.payout_mode = 'goods' and sp.status = 'pending';
  if not found then raise exception 'No goods payout waiting' using errcode = 'P0001'; end if;
  update public.school_allocations set status = 'paid', paid_at = now(), reference = 'goods-' || p_payout where payout_id = p_payout;
end $$;

-- An assisted school confirmed it received the money or goods; the admin records how.
create or replace function public.confirm_assisted_payout(p_payout bigint, p_how text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_caller() then raise exception 'Admins only' using errcode = '42501'; end if;
  if coalesce(length(btrim(p_how)), 0) < 3 then raise exception 'Say how the school confirmed' using errcode = '22023'; end if;
  update public.school_payouts sp set status = 'confirmed', confirmed_at = now(),
         note = left(concat_ws(' · ', sp.note, 'Confirmed: ' || btrim(p_how)), 300)
  from public.school_claims c
  where sp.id = p_payout and c.id = sp.claim_id and c.assisted_by is not null and sp.status = 'paid';
  if not found then raise exception 'No delivered payment waiting for confirmation' using errcode = 'P0001'; end if;
  update public.school_allocations set status = 'confirmed', confirmed_at = now() where payout_id = p_payout;
end $$;

-- What needs a person: claims to review, goods to deliver, confirmations to record.
create or replace function public.admin_school_queue()
returns table (kind text, id bigint, emis text, school text, town text, no_fee boolean, detail text,
               contact text, phone text, language text, amount_minor bigint, at timestamptz)
language sql stable
security definer
set search_path = public
as $$
  select 'review', c.id, c.emis, s.name, s.town, s.no_fee, c.review_reason,
         coalesce(a.contact_name, c.contact_name) || ' (' || coalesce(a.role, c.contact_role) || ')'
           || coalesce(', account "' || c.account_name || '" ' || c.bank_name || ' ..' || c.account_last4, ''),
         coalesce(c.contact_phone, u.email), c.language, null::bigint, c.created_at
  from public.school_claims c join public.schools s on s.emis = c.emis
  left join public.school_accounts a on a.user_id = c.user_id
  left join auth.users u on u.id = c.user_id
  where c.status = 'needs_review' and public.is_admin_caller()
  union all
  select case when sp.status = 'pending' then 'deliver' else 'confirm' end, sp.id, sp.emis, s.name, s.town, s.no_fee,
         case when sp.status = 'pending' then 'Buy and deliver goods' else coalesce(sp.note, 'Paid') end,
         c.contact_name || ' (' || c.contact_role || ')', c.contact_phone, c.language, sp.amount_minor, sp.created_at
  from public.school_payouts sp join public.school_claims c on c.id = sp.claim_id
  join public.schools s on s.emis = sp.emis
  where public.is_admin_caller() and c.assisted_by is not null
    and ((sp.status = 'pending' and c.payout_mode = 'goods') or sp.status = 'paid')
  order by 12
$$;

-- 6. The money log and the monthly sums -------------------------------------------------
-- Every change to a claim, a payout, a school's share or a sponsorship's
-- money is written here, and nothing can change or remove a line, us
-- included: the table refuses updates and deletes.
create table public.money_log (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  actor     uuid default auth.uid(),
  entity    text not null,
  entity_id bigint not null,
  action    text not null,
  old       jsonb,
  new       jsonb
);
create index money_log_entity on public.money_log (entity, entity_id, at);
alter table public.money_log enable row level security;
revoke all on public.money_log from anon, authenticated;

create or replace function public.money_log_fixed()
returns trigger
language plpgsql
as $$
begin
  raise exception 'The money log cannot be changed' using errcode = '42501';
end $$;
create trigger money_log_fixed before update or delete or truncate on public.money_log
  for each statement execute function public.money_log_fixed();

create or replace function public.money_log_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  eid bigint := coalesce((n ->> 'id')::bigint, (o ->> 'id')::bigint);
begin
  -- Sponsorships: only the money and its status matter here.
  if tg_table_name = 'sponsor_bookings' then
    o := (select jsonb_object_agg(k, o -> k) from unnest(array['status', 'price_minor', 'extra_minor', 'extra_fee_minor', 'own_school_minor',
          'partner_school_minor', 'prize_minor', 'scrumline_minor', 'provider_ref', 'paid_at']) k where o ? k);
    n := (select jsonb_object_agg(k, n -> k) from unnest(array['status', 'price_minor', 'extra_minor', 'extra_fee_minor', 'own_school_minor',
          'partner_school_minor', 'prize_minor', 'scrumline_minor', 'provider_ref', 'paid_at']) k where n ? k);
    if tg_op = 'UPDATE' and o = n then return null; end if;
  end if;
  insert into public.money_log (entity, entity_id, action, old, new)
  values (tg_table_name, eid, lower(tg_op), o, n);
  return null;
end $$;
revoke execute on function public.money_log_write() from public, anon, authenticated;
create trigger money_log after insert or update or delete on public.school_claims for each row execute function public.money_log_write();
create trigger money_log after insert or update or delete on public.school_payouts for each row execute function public.money_log_write();
create trigger money_log after insert or update or delete on public.school_allocations for each row execute function public.money_log_write();
create trigger money_log after insert or update or delete on public.sponsor_bookings for each row execute function public.money_log_write();

-- The sums that must hold, to the cent. An admin sees these; any line that
-- isn't ok is money to look into.
create or replace function public.money_checks()
returns table (check_name text, ok boolean, problems bigint, detail text)
language sql stable
security definer
set search_path = public
as $$
  with paid as (
    select b.* from public.sponsor_bookings b where b.status in ('paid', 'live', 'ended')
  ), by_booking as (
    select p.id, p.own_school_minor + p.partner_school_minor + p.extra_minor - p.extra_fee_minor as due,
           coalesce((select sum(a.amount_minor) from public.school_allocations a where a.booking_id = p.id), 0) as given
    from paid p
  ), by_payout as (
    select sp.id, sp.status, sp.amount_minor,
           coalesce((select sum(a.amount_minor) from public.school_allocations a where a.payout_id = sp.id), 0) as linked,
           (select bool_and(a.status = case sp.status when 'confirmed' then 'confirmed' when 'paid' then 'paid' else 'due' end)
            from public.school_allocations a where a.payout_id = sp.id) as statuses_ok
    from public.school_payouts sp where sp.status <> 'failed'
  )
  select 'Each sponsorship''s price splits exactly', count(*) = 0, count(*), 'price = schools + prizes + Scrumline'
  from paid where price_minor <> own_school_minor + partner_school_minor + prize_minor + scrumline_minor
  union all
  select 'Every rand owed to schools is given to a school', count(*) = 0, count(*), coalesce(sum(due - given), 0) || ' cents apart'
  from by_booking where due <> given
  union all
  select 'Each payout is exactly the shares in it', count(*) = 0, count(*), 'amount = sum of its shares, statuses agree'
  from by_payout where amount_minor <> linked or not coalesce(statuses_ok, false)
  union all
  select 'No share is paid without a payout', count(*) = 0, count(*), 'shares marked paid or confirmed need a paid payout'
  from public.school_allocations a
  where a.status <> 'due' and not exists (select 1 from public.school_payouts sp where sp.id = a.payout_id and sp.status in ('paid', 'confirmed'))
  union all
  select 'No money for a cancelled sponsorship', count(*) = 0, count(*), 'shares from bookings that are not paid'
  from public.school_allocations a join public.sponsor_bookings b on b.id = a.booking_id
  where b.status not in ('paid', 'live', 'ended')
  union all
  select 'Payouts waiting over 14 days', count(*) = 0, count(*), 'sent but not landed, or goods not delivered'
  from public.school_payouts where status in ('pending', 'sent') and created_at < now() - interval '14 days'
$$;

create or replace function public.admin_money_checks()
returns table (check_name text, ok boolean, problems bigint, detail text)
language sql stable
security definer
set search_path = public
as $$
  select * from public.money_checks() where public.is_admin_caller()
$$;
revoke execute on function public.admin_money_checks() from public, anon;
grant execute on function public.admin_money_checks() to authenticated;

-- 7. Sign-up email -----------------------------------------------------------------------
create or replace function public.send_school_link(p_email text, p_name text, p_link text, p_existing boolean)
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
      'subject', 'Claim your school on Scrumline',
      'htmlContent',
        '<p>' || case when who = '' then 'Hello' else 'Hello ' || who end || ',</p>'
        || case when p_existing
             then '<p>You already have a Scrumline account with this address, and it can now look after your school too. Use the link below to sign in, then open Your school.</p>'
             else '<p>Choose a password with the link below. You can then find your school, add its bank account and see what sponsors have raised for it.</p>' end
        || '<p><a href="' || link || '">' || case when p_existing then 'Sign in' else 'Choose a password' end || '</a></p>'
        || '<p style="color:#667">The link works once, for 24 hours. If you did not ask for this, ignore this email.</p>'
    )
  );
end $$;

-- 8. Grants and schedule ------------------------------------------------------------------
revoke execute on function public.add_school_account(uuid, text, text), public.record_school_claim(uuid, text, text, text, boolean, text),
  public.school_payout_result(text, boolean, text, text), public.send_school_link(text, text, text, boolean),
  public.make_school_payouts(bigint), public.send_school_payouts(), public.redirect_unclaimed_shares(),
  public.record_assisted_claim(uuid, text, text, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.set_school_account_school(text), public.flag_school_claim(bigint, text),
  public.school_claim_info(text), public.confirm_school_payout(bigint), public.school_dashboard(),
  public.assisted_goods_claim(text, text, text, text, text), public.record_goods_delivered(bigint, text),
  public.confirm_assisted_payout(bigint, text), public.admin_school_queue(), public.review_school_claim(bigint, boolean, text) from public, anon;
grant execute on function public.set_school_account_school(text), public.flag_school_claim(bigint, text),
  public.school_claim_info(text), public.confirm_school_payout(bigint), public.school_dashboard(),
  public.assisted_goods_claim(text, text, text, text, text), public.record_goods_delivered(bigint, text),
  public.confirm_assisted_payout(bigint, text), public.admin_school_queue(), public.review_school_claim(bigint, boolean, text) to authenticated;
revoke execute on function public.money_checks() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.add_school_account(uuid, text, text), public.record_school_claim(uuid, text, text, text, boolean, text),
      public.school_payout_result(text, boolean, text, text), public.send_school_link(text, text, text, boolean),
      public.record_assisted_claim(uuid, text, text, text, text, text, text, text, text, text, text) to service_role;
  end if;
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    -- 1st of the month, 08:00 SAST: make the payouts, then send them.
    perform cron.schedule('school-payouts', '0 6 1 * *', 'select public.make_school_payouts(); select public.send_school_payouts();');
    perform cron.schedule('unclaimed-shares', '30 5 * * *', 'select public.redirect_unclaimed_shares()');
  end if;
end $$;
