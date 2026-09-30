-- School scoring, round by round. Learner numbers say nothing about how many
-- old boys and girls a school has, so team size no longer follows them.
-- Each round, a school's score is the average of its best 20 confirmed players
-- who played that round (fewer than 20 is fine, all of them count). A school
-- needs at least 10 confirmed players in a round for that round to count;
-- otherwise it scores 0 for the round. The season score is the sum of the
-- round scores, so turning up every round matters.

create or replace function public.school_team_size() returns int language sql immutable as $$ select 20 $$;
create or replace function public.school_round_minimum() returns int language sql immutable as $$ select 10 $$;

drop function public.school_table(text, text);
create function public.school_table(p_season text, p_stage text)
returns table (
  emis           text,
  name           text,
  town           text,
  members        int,
  confirmed      int,
  score          numeric,  -- sum of counted round averages; null until a round counts
  rounds_counted int,
  best_turnout   int,      -- most confirmed players the school has had in one round
  mine           boolean
)
language sql stable
security definer
set search_path = public
as $$
  with players as (
    select sm.emis, sm.user_id, sm.verified, e.id as entry_id
    from public.school_members sm
    left join public.entries e on e.user_id = sm.user_id and e.season = p_season
    where sm.stage = p_stage and public.is_member()
  ), played as (
    -- confirmed players' points in each round they made a call that has been scored
    select p.emis, t.round, t.total_pts,
           row_number() over (partition by p.emis, t.round order by t.total_pts desc) as rn,
           count(*) over (partition by p.emis, t.round) as turnout
    from players p
    join public.entry_round_totals t on t.entry_id = p.entry_id and t.season = p_season and t.matches > 0
    where p.verified
  ), rounds as (
    select emis, round, max(turnout)::int as turnout,
           avg(total_pts) filter (where rn <= public.school_team_size()) as avg_pts
    from played
    group by emis, round
  ), per_school as (
    select p.emis, count(*)::int as members,
           (count(*) filter (where p.verified and p.entry_id is not null))::int as confirmed,
           bool_or(p.user_id = auth.uid()) as mine
    from players p
    group by p.emis
  )
  select ps.emis, sc.name, sc.town, ps.members, ps.confirmed,
         round(sum(r.avg_pts) filter (where r.turnout >= public.school_round_minimum()), 1),
         (count(r.round) filter (where r.turnout >= public.school_round_minimum()))::int,
         coalesce(max(r.turnout), 0)::int,
         ps.mine
  from per_school ps
  join public.schools sc on sc.emis = ps.emis
  left join rounds r on r.emis = ps.emis
  group by ps.emis, sc.name, sc.town, ps.members, ps.confirmed, ps.mine
$$;
revoke all on function public.school_table(text, text) from public, anon;
grant execute on function public.school_table(text, text) to authenticated;
