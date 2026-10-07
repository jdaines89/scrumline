#!/bin/sh
# Rebuilds a scratch database from the migrations and seed, then runs the
# behaviour tests. Needs a local Postgres 16: PGHOST/PGPORT/PGUSER as usual.
set -e
cd "$(dirname "$0")/.."
psql -qX -d postgres -c 'drop database if exists league_test' -c 'create database league_test'
for f in tests/00_supabase_stub.sql migrations/*.sql seed.sql tests/10_rls_test.sql tests/20_backup_test.sql tests/30_analytics_test.sql tests/40_round_openers_test.sql tests/50_login_codes_test.sql tests/60_nations_test.sql tests/70_knockout_test.sql tests/80_finance_test.sql tests/85_schools_test.sql tests/90_growth_test.sql tests/95_varsity_test.sql tests/96_leagues_test.sql tests/97_invite_round_test.sql tests/98_choose_password_test.sql tests/99_chat_polls_test.sql tests/100_match_moments_test.sql tests/101_chat_flood_test.sql; do
  psql -qX -v ON_ERROR_STOP=1 -d league_test -f "$f" 2>&1 | grep -E 'NOTICE|ERROR|PASSED' | sed 's/.*NOTICE:  //'
done
