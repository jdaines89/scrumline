-- Official tournament logos, hotlinked like the team badges (teams.badge_url).
-- Taken from TheSportsDB's league records (lookupleague strBadge), the same
-- source as the team badges. Varsity Cup has no record there, so it shows the
-- app's plain fallback until a real logo is sourced; logos are never invented.
alter table public.competitions add column if not exists badge_url text;

update public.competitions c set badge_url = v.url
from (values
  ('4446', 'https://r2.thesportsdb.com/images/media/league/badge/o6dhfo1716481482.png'),  -- United Rugby Championship
  ('4550', 'https://r2.thesportsdb.com/images/media/league/badge/kohne11716546580.png'),  -- Champions Cup
  ('5069', 'https://r2.thesportsdb.com/images/media/league/badge/4t35id1720081373.png'),  -- Currie Cup
  ('5418', 'https://r2.thesportsdb.com/images/media/league/badge/ewua6c1716755405.png'),  -- Challenge Cup
  ('5852', 'https://r2.thesportsdb.com/images/media/league/badge/jifczi1773608397.png')   -- Nations Championship
) as v(id, url)
where c.id = v.id;
