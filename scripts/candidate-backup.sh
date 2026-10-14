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

# Releases before vote unlinking (no rounds.votes_unlinked_at column) close rounds without shuffling.
# If such an API closed a round between the shuffle below and pg_dump, the dump would keep that round's
# votes in delegate order, and the open-round check could not notice. Require that API to be stopped.
HAS_UNLINKING="$("$ROOT_DIR/scripts/candidate-compose.sh" exec -T postgres sh -ec \
  'psql -X -tA --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --command="SELECT count(*) FROM information_schema.columns WHERE table_name = '"'"'rounds'"'"' AND column_name = '"'"'votes_unlinked_at'"'"'"')"
if [[ "${HAS_UNLINKING//[[:space:]]/}" != "1" ]] && "$ROOT_DIR/scripts/candidate-compose.sh" ps --status running --services | grep -qx api; then
  printf 'Refusing to back up: the database still has the pre-upgrade schema and the api service is running.\nStop it first: scripts/candidate-compose.sh stop api\n' >&2
  exit 3
fi

# A logical dump writes rows in physical order. Votes of rounds closed by a release before vote
# unlinking existed are still in the same order as their participation receipts, so re-insert every
# non-open round's votes in random order first (the same statement the API runs when closing a round).
# Vote ids are not referenced anywhere, so this changes nothing but row order and ids. It also works on
# the pre-upgrade schema, so the backup taken before migrating is safe too.
"$ROOT_DIR/scripts/candidate-compose.sh" exec -T postgres sh -ec \
  'psql -X -q -v ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --command="
    WITH removed AS (
      DELETE FROM anonymous_votes v USING rounds r WHERE v.round_id = r.id AND r.status <> '"'"'open'"'"'
      RETURNING v.round_id, v.option_id
    )
    INSERT INTO anonymous_votes (id, round_id, option_id)
    SELECT gen_random_uuid(), round_id, option_id FROM removed ORDER BY random()"'

TEMP_FILE="${BACKUP_FILE}.partial.$$"
trap 'rm -f "$TEMP_FILE"' EXIT
"$ROOT_DIR/scripts/candidate-compose.sh" exec -T postgres sh -ec \
  'pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom' > "$TEMP_FILE"
chmod 600 "$TEMP_FILE"
"$ROOT_DIR/scripts/candidate-compose.sh" exec -T postgres pg_restore --list < "$TEMP_FILE" >/dev/null

# The check above can race with a ballot opening before pg_dump takes its snapshot. pg_dump is a
# single consistent snapshot, so inspect the archive itself: no round may be open inside it.
OPEN_IN_DUMP="$("$ROOT_DIR/scripts/candidate-compose.sh" exec -T postgres pg_restore --data-only --table=rounds --file=- < "$TEMP_FILE" \
  | awk -F'\t' '
      /^COPY public\.rounds / {
        header = $0; sub(/^[^(]*\(/, "", header); sub(/\).*$/, "", header)
        n = split(header, columns, /, /); for (i = 1; i <= n; i++) if (columns[i] == "status") index_of_status = i
        copying = 1; next
      }
      copying && $0 == "\\." { copying = 0; next }
      copying && index_of_status && $index_of_status == "open" { open++ }
      END { if (!index_of_status) print "unknown"; else print open + 0 }')"
if [[ "$OPEN_IN_DUMP" != "0" ]]; then
  printf 'Discarding backup: a ballot was open when the dump was taken (open rounds in snapshot: %s). Retry after it closes.\n' "$OPEN_IN_DUMP" >&2
  exit 3
fi
mv -- "$TEMP_FILE" "$BACKUP_FILE"
trap - EXIT
printf 'Backup created and archive verified: %s\n' "$BACKUP_FILE"
