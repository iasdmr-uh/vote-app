#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
ENV_FILE="${COMPOSE_ENV_FILE:-$ROOT_DIR/.env.candidate}"

if [[ ! -f "$ENV_FILE" ]]; then
  printf 'Candidate env file not found: %s\n' "$ENV_FILE" >&2
  printf 'Copy .env.candidate.example to .env.candidate and fill in the approved candidate values.\n' >&2
  exit 2
fi

exec docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.candidate.yml" "$@"
