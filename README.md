# Scrumline

An invite-only fantasy league for the Currie Cup, running on real results and
free tiers only.

- **App:** Next.js 15 (React, TypeScript), exported as a static site and served
  from GitHub Pages. Screens: score predictions (with a double-points Banker each round), fixtures, the log
  and the leaderboard. Each union shows as its jersey colour with initials.
- **Data:** Supabase (Postgres + Auth). Four layers, raw feed payloads to core
  tables to league tables to scoring views, with every rule (four picks, one
  captain, round locks) and every permission enforced in the database. See
  [`supabase/README.md`](supabase/README.md).
- **Feed:** TheSportsDB's free tier, pulled hourly by the database itself.
- **Access:** invite-only. Invite people from the Supabase dashboard
  (Authentication > Users > Invite user); nobody else can see anything.

## Run it

```sh
npm install
cp .env.example .env.local   # Supabase URL and publishable key
npm run dev
```

`npm test` runs the scoring unit tests; `npm run db:test` rebuilds the database
on a local Postgres 16 and runs the security and rules checks.

## Deploy

Every push to `main` builds and publishes to GitHub Pages
(`.github/workflows/pages.yml`). The old single-file demo in `docs/` is not published: everything on the site sits behind the invite-only sign-in.

## Team badges

The official badges are the unions' trademarks, so the app shows every team as
its jersey colour with initials. The badge links stay in the database, and a
build with `NEXT_PUBLIC_SHOW_OFFICIAL_LOGOS=1` shows them again once there is a
licence.
