-- Call before you join: an invite link shows the next round's games, so a
-- newcomer can call the scores before giving an email. The calls wait in
-- their browser and are saved to their team once they're in.
--
-- What it shows is public anyway (fixtures, kick-off times, team names and
-- colours). For a league link, the games come from that league's tournament;
-- otherwise from the tournament with the soonest game coming up. Only games
-- that haven't kicked off, and only the next round.
--
-- Additive only.

create or replace function public.invite_round(p_code text default null)
returns table (
  season_id text, season_name text, round int,
  match_id text, kickoff_at timestamptz, venue text,
  home_id text, home_name text, home_short text, home_colour text, home_ink text, home_badge text,
  away_id text, away_name text, away_short text, away_colour text, away_ink text, away_badge text
)
language sql stable
security definer
set search_path = public
as $$
  with pick as (
    select coalesce(
      (select p.season from public.pools p join public.seasons s on s.id = p.season
        where p.join_code = upper(btrim(p_code)) and p.school_emis is null and not s.is_replay),
      (select m.season from public.matches m join public.seasons s on s.id = m.season
        where not s.is_replay and m.kickoff_at > now() and m.home_score is null
        order by m.kickoff_at limit 1)
    ) as season
  ), nxt as (
    select m.season, min(m.round) as round
    from public.matches m join pick on pick.season = m.season
    where m.kickoff_at > now() and m.home_score is null
    group by m.season
  )
  select s.id, s.name, m.round, m.id, m.kickoff_at, m.venue,
         h.id, h.display_name, h.short_name, h.colour, h.colour_ink, h.badge_url,
         a.id, a.display_name, a.short_name, a.colour, a.colour_ink, a.badge_url
  from nxt
  join public.seasons s on s.id = nxt.season
  join public.matches m on m.season = nxt.season and m.round = nxt.round
  join public.teams h on h.id = m.home_team_id
  join public.teams a on a.id = m.away_team_id
  where m.kickoff_at > now() and m.home_score is null
  order by m.kickoff_at, m.id
$$;
revoke execute on function public.invite_round(text) from public;
grant execute on function public.invite_round(text) to anon, authenticated;
