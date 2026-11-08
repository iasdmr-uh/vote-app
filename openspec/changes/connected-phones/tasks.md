## 1. Domain

- [x] 1.1 Write failing unit tests for `connectedInBase` covering an empty base, everyone connected, online people outside the base, and the invariant that X never exceeds Y, then implement it and verify the tests pass

## 2. Presence tracking

- [x] 2.1 Write failing tests for `ConnectionPresence` with an injected clock: two sockets of one person count once, a drop that recovers within 3 s reports nothing, a drop past 3 s reports offline, and the last of two sockets dropping reports offline. Implement and verify they pass
- [x] 2.2 Track participant sockets in `RealtimeGateway` on connect and disconnect, derive the heartbeat interval and timeout from the loss limit and the grace, and verify with a gateway test that connect and disconnect reach the tracker and no participant id reaches the logger

## 3. Count and broadcast

- [x] 3.1 Write a failing service test for `VotingService.openRoundBase` covering active delegates, disabled delegates in the base, and the regional secretary in and out of the vote. Implement it, derive the existing base count from it, and verify the existing participation tests still pass unchanged
- [x] 3.2 Write failing tests for `ConnectionCountService`: it emits `connection.count` with only roundId, connected and base to public and moderator rooms, emits only on change, and emits nothing when no vote is open. Implement and verify
- [x] 3.3 Add `connection` to the public-state and moderator state responses while a vote is open, omit it otherwise, and verify with controller or integration tests

## 4. Web

- [x] 4.1 Add the phone signal with a 3 s grace to `useAssembly`, show «Conectado» during an open vote and the existing notice when down, and verify with a mocked E2E test that a phone shows exactly one of the two
- [x] 4.2 Show "X de Y conectados" on the projector and in the mesa while a vote is open, hide it after close or annul, and verify with mocked E2E tests that no per-person offline marker renders

## 5. Docs and verification

- [x] 5.1 Document `connection.count` and the heartbeat in `apps/api/src/realtime/README.md` and `docs/foundation/api-and-events.md`, and state the locked-screen limit in `docs/scope.md`
- [x] 5.2 Run `npm run typecheck`, API tests with `TEST_DATABASE_URL`, `npm run test:e2e` and `npm run test:e2e:integration`, and verify all pass
