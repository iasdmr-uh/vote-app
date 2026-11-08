## Why

Issue #78: a reconnection code lets whoever holds it vote as that delegate. If the operator could issue or use one while a vote is open, the operator could vote in someone's place. On 8 November 2026 the owner set the general rule that nothing can interrupt an open vote.

## What Changes

- Issuing a reconnection code is refused while a vote is open.
- Redeeming any one-use code is refused while a vote is open. This covers reconnection codes issued before the vote opened and the regional secretary's unused entry QR. The code stays valid and works again once the vote closes or is annulled, until it is used or expires.
- A phone that keeps its session token keeps working through a vote. Only moving a session to a new device is blocked.
- The regional secretary gets no reconnection code. A lost secretary device is handled by taking them out and joining again by QR (#85).
- The console hides «Reconectar dispositivo» while a vote is open, and never offers it for the regional secretary.
- `docs/scope.md` section 8 rule 15 says reconnection codes cannot be issued or used during a vote.

Out of scope:
- How the regional secretary joins (#85).
- Annulling an open vote. It already exists with a recorded reason; this change relies on it.

## Capabilities

### New Capabilities

- `reconnection`: when the operator can move a delegate's session to a new device.

### Modified Capabilities

None.

## Impact

- API: `VotingService.issueResumeCode` and `redeemResumeCode` in `apps/api/src/voting/voting.service.ts`.
- Web: `apps/web/src/components/ModeratorParticipants.vue`.
- Tests that issued or redeemed a code during an open vote now do it after the vote closes: `apps/api/test/integration/recovery.spec.ts`, and the matching E2E expectations in `tests/e2e/mocked/`.
- Docs: `docs/scope.md`.
