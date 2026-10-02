#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [[ $# -ne 1 || ! -f "$1" || ! -r "$1" ]]; then
  printf 'Usage: %s <readable-custom-format-backup.dump>\n' "$0" >&2
  exit 2
fi
BACKUP_FILE="$(cd -- "$(dirname -- "$1")" && pwd)/$(basename -- "$1")"
RESTORE_DB="asdmr_restore_check_$(date -u +%Y%m%d%H%M%S)_$$"
COMPOSE="$ROOT_DIR/scripts/candidate-compose.sh"
CREATED=0

cleanup() {
  if [[ "$CREATED" == 1 ]]; then
    "$COMPOSE" exec -T postgres sh -ec 'dropdb --if-exists --username="$POSTGRES_USER" "$1"' sh "$RESTORE_DB" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

"$COMPOSE" exec -T postgres sh -ec 'createdb --username="$POSTGRES_USER" "$1"' sh "$RESTORE_DB"
CREATED=1
"$COMPOSE" exec -T postgres sh -ec \
  'pg_restore --clean --if-exists --no-owner --no-privileges --username="$POSTGRES_USER" --dbname="$1"' \
  sh "$RESTORE_DB" < "$BACKUP_FILE"

TABLE_COUNT="$("$COMPOSE" exec -T postgres sh -ec \
  'psql -X -A -t -v ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname="$1" -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '\''public'\'' AND table_name IN ('\''organizations'\'', '\''assemblies'\'', '\''rounds'\'', '\''anonymous_votes'\'')"' \
  sh "$RESTORE_DB" | tr -d '\r')"
if [[ "$TABLE_COUNT" != 4 ]]; then
  printf 'Restore verification failed: expected 4 application tables, found %s\n' "$TABLE_COUNT" >&2
  exit 1
fi

printf 'Restore verified in disposable database %s (4 core tables present).\n' "$RESTORE_DB"
