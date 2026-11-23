#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p backups
COMPOSE=(docker compose --env-file .env.production -f compose.production.yaml)
"${COMPOSE[@]}" exec -T db pg_dump -U arrangement arrangement | gzip > "backups/postgres-$STAMP.sql.gz"
"${COMPOSE[@]}" run --rm --no-deps -v "$ROOT/backups:/backup" --entrypoint tar app \
  -czf "/backup/app-data-$STAMP.tar.gz" -C /data .
echo "Saved backups/postgres-$STAMP.sql.gz and backups/app-data-$STAMP.tar.gz"
