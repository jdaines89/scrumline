-- Sponsor rewards: an achievement can unlock a voucher a sponsor has supplied.
-- Nothing shows to players until an admin creates and switches on a campaign.
-- Players never read the codes table: unlocking is checked here, on the server,
-- from their own scored calls, and a code is only ever handed out by claim_reward().
-- Admins see counts only (how many codes, claimed, left), never who claimed.

create table if not exists public.reward_campaigns (
  id bigint generated always as identity primary key,
  season text not null references public.seasons (id),
  title text not null check (char_length(title) between 3 and 80),
  sponsor_name text check (char_length(sponsor_name) <= 60),
  achievement_key text not null check (achievement_key in ('sharpshooter', 'clean-sweep', 'banker-bang', 'dead-on')),
  terms text check (char_length(terms) <= 600),
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.reward_codes (
  id bigint generated always as identity primary key,
  campaign_id bigint not null references public.reward_campaigns (id) on delete cascade,
  code text not null check (char_length(code) between 3 and 80),
  claimed_by uuid references auth.users (id) on delete set null,
  claimed_at timestamptz,
  unique (campaign_id, code)
);
-- One reward per person per campaign.
create unique index if not exists reward_codes_one_each on public.reward_codes (campaign_id, claimed_by) where claimed_by is not null;
create index if not exists reward_codes_free on public.reward_codes (campaign_id, id) where claimed_by is null;

alter table public.reward_campaigns enable row level security;
alter table public.reward_codes enable row level security;
revoke all on public.reward_campaigns, public.reward_codes from anon, authenticated;

-- Has this entry earned the achievement in this tournament? Mirrors src/lib/achievements.ts.
create or replace function public.achievement_earned(p_entry bigint, p_season text, p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_key
    when 'sharpshooter' then coalesce((
      with rds as (select distinct round from public.matches where season = p_season)
      select max(w.n) >= 3 from (
        select (select count(*) from public.prediction_points pp
                where pp.entry_id = p_entry and pp.season = p_season and pp.exact_pts > 0
                  and pp.round in (select round from rds where round >= r.round order by round limit 3)) as n
        from rds r) w), false)
    when 'clean-sweep' then exists (
      select 1 from public.prediction_points pp
      where pp.entry_id = p_entry and pp.season = p_season
      group by pp.round
      having count(*) = (select count(*) from public.matches m where m.season = p_season and m.round = pp.round)
         and bool_and(pp.right_result))
    when 'banker-bang' then exists (
      select 1 from public.prediction_points pp
      where pp.entry_id = p_entry and pp.season = p_season and pp.is_banker and pp.exact_pts > 0)
    when 'dead-on' then exists (
      select 1 from public.prediction_points pp
      where pp.entry_id = p_entry and pp.season = p_season
      group by pp.round having count(*) filter (where pp.near_pts >= 4) >= 5)
    else false end
$$;
revoke execute on function public.achievement_earned(bigint, text, text) from public, anon, authenticated;

-- What you can see for a tournament: live campaigns, whether you've unlocked each, and your own code once claimed.
create or replace function public.my_rewards(p_season text)
returns table (campaign_id bigint, title text, sponsor_name text, achievement_key text, terms text,
               ends_at timestamptz, remaining bigint, earned boolean, claimed boolean, code text)
language sql stable security definer set search_path = public as $$
  select c.id, c.title, c.sponsor_name, c.achievement_key, c.terms, c.ends_at,
         (select count(*) from public.reward_codes k where k.campaign_id = c.id and k.claimed_by is null),
         coalesce(public.achievement_earned(e.id, c.season, c.achievement_key), false),
         mine.code is not null, mine.code
  from public.reward_campaigns c
  left join public.entries e on e.user_id = auth.uid() and e.season = c.season
  left join lateral (select k.code from public.reward_codes k where k.campaign_id = c.id and k.claimed_by = auth.uid()) mine on true
  where auth.uid() is not null and c.season = p_season and c.active
    and (c.starts_at is null or c.starts_at <= now()) and (c.ends_at is null or c.ends_at > now())
$$;
revoke execute on function public.my_rewards(text) from public, anon;
grant execute on function public.my_rewards(text) to authenticated;

create or replace function public.claim_reward(p_campaign bigint)
returns text language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  c public.reward_campaigns;
  got text;
  pick bigint;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  select * into c from public.reward_campaigns
   where id = p_campaign and active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now());
  if not found then raise exception 'This reward isn''t available.'; end if;
  select code into got from public.reward_codes where campaign_id = c.id and claimed_by = me;
  if got is not null then return got; end if;
  if not coalesce(public.achievement_earned((select id from public.entries where user_id = me and season = c.season), c.season, c.achievement_key), false) then
    raise exception 'Unlock the badge first.';
  end if;
  select id into pick from public.reward_codes where campaign_id = c.id and claimed_by is null order by id limit 1 for update skip locked;
  if pick is null then raise exception 'All of these rewards have been claimed.'; end if;
  update public.reward_codes set claimed_by = me, claimed_at = now() where id = pick returning code into got;
  return got;
end $$;
revoke execute on function public.claim_reward(bigint) from public, anon;
grant execute on function public.claim_reward(bigint) to authenticated;

-- Admin: create or change a campaign (admins only). Counts, never who claimed.
create or replace function public.admin_save_reward(p_id bigint, p_season text, p_title text, p_sponsor text, p_key text,
                                                    p_terms text, p_starts timestamptz, p_ends timestamptz, p_active boolean)
returns bigint language plpgsql security definer set search_path = public as $$
declare out_id bigint;
begin
  perform moderation.require_admin();
  if p_id is null then
    insert into public.reward_campaigns (season, title, sponsor_name, achievement_key, terms, starts_at, ends_at, active)
    values (p_season, trim(p_title), nullif(trim(p_sponsor), ''), p_key, nullif(trim(p_terms), ''), p_starts, p_ends, coalesce(p_active, false))
    returning id into out_id;
  else
    update public.reward_campaigns set season = p_season, title = trim(p_title), sponsor_name = nullif(trim(p_sponsor), ''),
           achievement_key = p_key, terms = nullif(trim(p_terms), ''), starts_at = p_starts, ends_at = p_ends, active = coalesce(p_active, false)
     where id = p_id returning id into out_id;
  end if;
  return out_id;
end $$;
revoke execute on function public.admin_save_reward(bigint, text, text, text, text, text, timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.admin_save_reward(bigint, text, text, text, text, text, timestamptz, timestamptz, boolean) to authenticated;

-- Admin: paste codes, one per line or comma-separated. Repeats are ignored.
create or replace function public.admin_add_reward_codes(p_campaign bigint, p_codes text)
returns int language plpgsql security definer set search_path = public as $$
declare added int;
begin
  perform moderation.require_admin();
  insert into public.reward_codes (campaign_id, code)
  select distinct p_campaign, trim(x) from regexp_split_to_table(coalesce(p_codes, ''), '[\n,;]+') as x
  where char_length(trim(x)) between 3 and 80
  on conflict do nothing;
  get diagnostics added = row_count;
  return added;
end $$;
revoke execute on function public.admin_add_reward_codes(bigint, text) from public, anon;
grant execute on function public.admin_add_reward_codes(bigint, text) to authenticated;

create or replace function public.admin_rewards()
returns table (id bigint, season text, title text, sponsor_name text, achievement_key text, terms text,
               starts_at timestamptz, ends_at timestamptz, active boolean, total bigint, claimed bigint, remaining bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform moderation.require_admin();
  return query
    select c.id, c.season, c.title, c.sponsor_name, c.achievement_key, c.terms, c.starts_at, c.ends_at, c.active,
           count(k.id), count(k.claimed_by), count(k.id) filter (where k.claimed_by is null)
    from public.reward_campaigns c left join public.reward_codes k on k.campaign_id = c.id
    group by c.id order by c.id desc;
end $$;
revoke execute on function public.admin_rewards() from public, anon;
grant execute on function public.admin_rewards() to authenticated;
