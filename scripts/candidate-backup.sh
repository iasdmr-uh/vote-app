#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups/candidate}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
BACKUP_FILE="${1:-$BACKUP_DIR/asdmr-candidate-$(date -u +%Y%m%dT%H%M%SZ).dump}"
umask 077

if [[ -e "$BACKUP_FILE" ]]; then
  printf 'Refusing to overwrite existing backup: %s\n' "$BACKUP_FILE" >&2
  exit 2
fi

# While a ballot is open, votes and participation receipts are still linkable at the storage level
# (they are unlinked when the round closes), so a dump taken now could reveal individual votes.
OPEN_ROUNDS="$("$ROOT_DIR/scripts/candidate-compose.sh" exec -T postgres sh -ec \
  'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align --command="SELECT count(*) FROM rounds WHERE status = '"'"'open'"'"'"')"
if [[ "${OPEN_ROUNDS//[[:space:]]/}" != "0" ]]; then
  printf 'Refusing to back up while a ballot is open (%s open). Close the round first.\n' "${OPEN_ROUNDS//[[:space:]]/}" >&2
  exit 3
fi

TEMP_FILE="${BACKUP_FILE}.partial.$$"
trap 'rm -f "$TEMP_FILE"' EXIT
"$ROOT_DIR/scripts/candidate-compose.sh" exec -T postgres sh -ec \
  'pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom' > "$TEMP_FILE"
chmod 600 "$TEMP_FILE"
"$ROOT_DIR/scripts/candidate-compose.sh" exec -T postgres pg_restore --list < "$TEMP_FILE" >/dev/null
mv -- "$TEMP_FILE" "$BACKUP_FILE"
trap - EXIT
printf 'Backup created and archive verified: %s\n' "$BACKUP_FILE"
