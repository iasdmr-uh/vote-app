# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See `/mnt/shared/development/CLAUDE.md` for global development guidelines.

## Overview

Web app for secret ballots at an in-person ASDMR delegates' assembly. It is an npm workspace with a NestJS API (`apps/api`), a Vue 3 client (`apps/web`) and PostgreSQL through Prisma. The UI and docs are in Spanish. Code and code comments are in English.

## Commands

Requires Node `^22.22.3 || ^24.15.0`. CI uses 24.15.0. Local setup is in `docs/development.md`.

| Task | Command |
|---|---|
| Install | `npm ci` |
| Start PostgreSQL | `docker compose up -d postgres` |
| Generate Prisma client | `npm run db:generate --workspace @asdmr/api` |
| Create or apply dev migrations | `npm run db:migrate --workspace @asdmr/api` |
| Run API | `npm run dev:api` |
| Run web | `npm run dev` |
| Typecheck | `npm run typecheck` |
| Build | `npm run build` |
| Unit tests | `npm test` |
| Integration tests | `npm run test:integration` |
| One API test file | `cd apps/api && node --import tsx --test test/unit/committee-ballot.spec.ts` |
| Mocked E2E | `npm run test:e2e` |
| One E2E file | `npx playwright test tests/e2e/mocked/acta.spec.ts --project=chromium` |
| Real-stack E2E | `npm run test:e2e:real-stack` |
| Scenarios in the browser | `npm run test:scenarios:browser:headed` |
| Load test | `npm run test:load` |

- The repo has no lint script.
- Generate the Prisma client before typechecking or building, because it is written to the gitignored `apps/api/src/generated/prisma/`.

## Tests

- `docs/testing.md` defines the test levels and conventions.
- Integration tests fail unless `TEST_DATABASE_URL` is set. Point it at a disposable database with migrations applied, because these tests run `VACUUM FULL` and delete data.
- `npm run test:integration:local` starts a throwaway PostgreSQL from `docker-compose.yml`, applies migrations and runs them. `npm run test:db:down` removes it.
- `npm run test:e2e` intercepts API responses, so it does not exercise the API or database.
- `npm run test:e2e:real-stack` starts its own isolated PostgreSQL through Docker or local tools. CI runs it only in the merge queue.
- Service tests construct `VotingService` directly and stub `RealtimeGateway` with a `Proxy`.

## Architecture

### API

- `voting/voting.service.ts` holds most domain logic. Transactions take `FOR UPDATE` row locks to serialize state changes.
- `voting/results-engine.ts` computes results, and `voting/presentation.service.ts` handles «Presentar oficiales».
- `auth/` has three access levels:
  - Public callers use the assembly code.
  - Participants use a session token.
  - Moderators use `MODERATOR_ACCESS_TOKEN` as a bearer token.
- Join codes, session tokens and resume codes are stored as hashes.
- Only one live assembly can exist, and `VotingService` enforces this under a lock on the organization row.

### Vote secrecy

Changes to voting, backups or logging must preserve these rules. `docs/foundation/data-model.md` has the full reasoning.

- `AnonymousVote` has no reference to a participant. `Participation` records only that someone voted in a round.
- Both rows are inserted in one transaction, so `xmin` and physical order can link them while a round is open.
- Closing a round reinserts its votes in random order. `VACUUM FULL` then runs on a dedicated connection, and only its success sets `rounds.votes_unlinked_at`.
- Publishing and completing an assembly are rejected while any settled round is still linked.
- The API refuses to start with pending cleanup unless `ALLOW_START_WITH_PENDING_VOTE_CLEANUP=true`.
- `scripts/candidate-backup.sh` refuses to back up while a ballot is open.

### Realtime

- Socket.IO events on `/events` are notices without delivery guarantees. Clients recover authoritative state over HTTP after connecting or reconnecting.
- The server assigns rooms from validated credentials. Clients cannot request rooms or send commands by socket.
- Emit events only after the transaction commits, and never include tokens, individual selections or session ids in broadcasts.
- `apps/api/src/realtime/README.md` documents the connection contract.

### Web

- `App.vue` picks one of three views from the URL path:
  - `/` renders `Telefono.vue` for delegates.
  - `/moderator` renders `Mesa.vue` for the mesa.
  - `/projector` renders `Proyector.vue` for the public screen.
- `useAssembly.ts` holds shared state in module-level refs, plus HTTP and socket handling. `useMesa.ts` adds moderator actions on top of it.
- `resultados.ts` holds the ranking, tie and percentage helpers shared by views.
- `locale/es.ts` holds every on-screen Spanish string, and components read it by key, such as `es.phone.reviewVote`.

### Deployment modes

| Mode | Files | Guide |
|---|---|---|
| Local development | `docker-compose.yml`, `.env.example` | `docs/development.md` |
| Candidate over HTTPS | `docker-compose.candidate.yml`, `Caddyfile.candidate`, `scripts/candidate-*.sh` | `docs/candidate-environment.md` |
| Assembly on a LAN | `docker-compose.lan.yml`, `Caddyfile.lan`, `scripts/lan.sh` | `docs/lan-assembly.md` |

In LAN mode, `MODERATOR_LOCAL_ONLY=true` limits the mesa to the server laptop. Caddy overwrites the `x-asdmr-channel` header on each listener, and the API checks it in `config/moderator-channel.ts`.

## Docs

- `docs/scope.md`: product scope and institutional decisions
- `docs/foundation/`: architecture decision, data model, state transitions, API and events
- `docs/plan/`: phase backlog and verification plan
