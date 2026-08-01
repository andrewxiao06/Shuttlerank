#!/usr/bin/env bash
#
# Re-point a player row to a new Clerk user id. Needed when a person's Clerk
# identity changes (e.g. dev -> production instance) but their player row +
# match history should follow them.
#
# Usage (on the EC2 box, from ~/dubr):
#   bash scripts/relink_player.sh <player_id> <new_clerk_user_id>
#
# Reads DATABASE_URL from .env.prod (no secret baked in) and runs the update
# via a throwaway psql container (the DB now lives on Neon, no local db svc).
#
set -euo pipefail
cd "$(dirname "$0")/.."

PID="${1:?usage: relink_player.sh <player_id> <new_clerk_user_id>}"
NEWID="${2:?usage: relink_player.sh <player_id> <new_clerk_user_id>}"

U="$(grep '^DATABASE_URL=' .env.prod | sed -E 's/^DATABASE_URL=//; s/\+asyncpg//')"

echo ">> Before:"
docker run --rm postgres:16-alpine psql "$U" -tA \
  -c "SELECT id||' | '||name||' | '||coalesce(clerk_user_id,'(none)') FROM players WHERE id=$PID;"

docker run --rm postgres:16-alpine psql "$U" -v ON_ERROR_STOP=1 \
  -c "UPDATE players SET clerk_user_id='$NEWID' WHERE id=$PID;"

echo ">> After:"
docker run --rm postgres:16-alpine psql "$U" -tA \
  -c "SELECT id||' | '||name||' | '||clerk_user_id FROM players WHERE id=$PID;"
