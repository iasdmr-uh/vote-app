## Why

Issue #78: on 8 November 2026 the owner set the rule that nothing can interrupt an open vote. #117 covered joining, reconnection and the assembly code. An audit of every other mesa action found three that could still run mid-vote, and the owner then decided that preparing the next vote must wait too.

## What Changes

1. While a vote is open, the API refuses «Presentar oficiales», which would replace the vote on the projector.
2. While a vote is open, the API refuses adding an election to the officials list.
3. While a vote is open, the API refuses retrying the vote-secrecy cleanup, which locks the votes table and would stall ballots. Closing the vote runs the cleanup anyway.
4. While a vote is open, the API refuses every way of preparing the next vote: creating a ballot, adding a department, repeating an annulled vote, adding or removing a draft's candidates, and adding or removing the regional secretary.
5. The mesa hides «Presentar oficiales» and «Reintentar limpieza» during a vote. The "is a vote open" check lives in one place, `voteOpen` in `useMesa.ts`. The preparation controls were already absent during a vote, because the mesa shows the open vote as its current round; an E2E test now holds that.
6. `docs/scope.md` section 8 rule 5 lists these refusals.

Out of scope:
1. Downloading the operator log during a vote. It writes an audit entry and does not touch the vote; left unchanged pending an owner decision.

## Capabilities

### New Capabilities

1. `open-vote`: what the mesa can still do while a vote is open.

### Modified Capabilities

None.

## Impact

1. API: `presentation.service.ts`, `official-roster.service.ts`, and `VotingService` (secrecy cleanup retry, `createRound`, `addPosition`, repeating an annulled vote, draft candidate and secretary edits) in `apps/api/src/voting/`.
2. Web: `Mesa.vue`, `ModeratorPresentationBar.vue`, `ModeratorParticipants.vue`, `useMesa.ts`.
3. Tests: `apps/api/test/integration/open-vote-guards.spec.ts`, `tests/e2e/mocked/moderator.spec.ts`.
4. Docs: `docs/scope.md`.
