## Why

Issue #55: delegates must trust that the operator at the laptop cannot use the tool to learn how anyone voted, see the trend of a vote, or vote in someone's place. Today the operator console still receives who voted in the latest vote, and the operator can disable or take out a delegate while a vote is open, which can cut off the last person who has not voted.

## What Changes

- **BREAKING** The moderator assembly state no longer includes a per-person voted flag for participants or for the regional secretary. Only the aggregate count of people who voted and the base remain.
- The operator console stops showing «Votó/Falta» for the regional secretary and the «falta/faltan» count, which is derived from the per-person flag.
- Disabling («Inhabilitar»), re-enabling («Habilitar») and «Retirar de la sala» are refused while a vote is open.
- The console hides those three actions while a vote is open.
- `docs/scope.md` sections 9 and 18 and section 8 rule 15 stop describing the operator's list of who voted and these actions during a vote.

Out of scope, owned by other issues:
- "X de Y conectados" (#84).
- Blocking reconnection codes during a vote (#78).
- How the regional secretary joins (#85).

## Capabilities

### New Capabilities

- `operator-secrecy`: what the operator can see and do around an open vote, so the operator cannot learn or steer how anyone votes.

### Modified Capabilities

None. `openspec/specs/` is empty.

## Impact

- API: `VotingService.moderatorAssembly`, `setVotingDisabled`, `takeOutOfRoom` in `apps/api/src/voting/voting.service.ts`.
- Web: `apps/web/src/components/ModeratorParticipants.vue`, `apps/web/src/useMesa.ts`, `apps/web/src/types.ts`.
- Tests that assert the per-person flag change their expected results, because #55 reverses that rule: `apps/api/test/voting.integration.spec.ts`, `committee-ballot.spec.ts`, `regional-secretary.integration.spec.ts`, and matching E2E fixtures.
- Docs: `docs/scope.md`.
