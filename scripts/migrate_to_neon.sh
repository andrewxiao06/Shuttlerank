#!/usr/bin/env bash
#
# One-shot: copy the local Dockerized Postgres into Neon.
#
# Usage (run on the EC2 box, from ~/dubr):
#   export NEON='postgresql://USER:PASS@HOST/neondb?sslmode=require'   # from Neon dashboard
#   bash scripts/migrate_to_neon.sh
#
# The Neon URL is read from $NEON so no secret is baked into this file. The
# script strips the "-pooler" host suffix automatically (migrations must use
# Neon's direct endpoint, not the connection pooler).
#
set -euo pipefail
cd "$(dirname "$0")/.."

: "${NEON:?Set NEON to your Neon connection string first (export NEON='postgresql://...')}"
NEON="${NEON/-pooler/}"   # use the direct endpoint, not the pooler

# Source the DB credentials for the local (source) database.
set -a; . ./.env.prod; set +a

DC="docker compose -f docker-compose.prod.yml"

echo ">> Dumping local database ($POSTGRES_DB)…"
$DC exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --no-owner --no-privileges > /tmp/neon_dump.sql
echo "   dump size: $(wc -l < /tmp/neon_dump.sql) lines"

echo ">> Restoring into Neon…"
$DC exec -T db psql "$NEON" -v ON_ERROR_STOP=1 < /tmp/neon_dump.sql

echo ">> Verifying row counts on Neon:"
$DC exec -T db psql "$NEON" -c \
  "SELECT (SELECT count(*) FROM players)       AS players,
          (SELECT count(*) FROM matches)       AS matches,
          (SELECT count(*) FROM match_players) AS match_players,
          (SELECT count(*) FROM player_ratings) AS ratings,
          (SELECT count(*) FROM tournaments)   AS tournaments,
          (SELECT count(*) FROM tournament_entries) AS entries;" \
  -c "SELECT version_num FROM alembic_version;"

echo ">> Done. Remove the dump: rm /tmp/neon_dump.sql"
