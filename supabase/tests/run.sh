#!/bin/sh
# Rebuilds a scratch database from the migrations and seed, then runs the
# behaviour tests. Needs a local Postgres 16: PGHOST/PGPORT/PGUSER as usual.
set -e
cd "$(dirname "$0")/.."
psql -qX -d postgres -c 'drop database if exists league_test' -c 'create database league_test'
for f in tests/00_supabase_stub.sql migrations/*.sql seed.sql tests/10_rls_test.sql tests/20_backup_test.sql; do
  psql -qX -v ON_ERROR_STOP=1 -d league_test -f "$f" 2>&1 | grep -E 'NOTICE|ERROR|PASSED' | sed 's/.*NOTICE:  //'
done
