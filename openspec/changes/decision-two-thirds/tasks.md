## 1. Engine

- [x] 1.1 Write failing unit tests for `thresholdVotes` and `meetsThreshold` under `two_thirds`, covering 28 → 19, 30 → 20, base 0 and the invariant that the 2/3 threshold sits between simple majority and 3/4. Implement and verify
- [x] 1.2 Write failing unit tests for `decisionOutcome` under `two_thirds` for both formats. Verify they pass

## 2. API and database

- [x] 2.1 Write a failing integration test that a decision accepts `two_thirds`, an election rejects it, and the database rejects an unknown rule. Add the DTO value and the check constraint migration, and verify
- [x] 2.2 Write a failing integration test that a 2/3 decision with 28 in the room needs 19 and counts abstentions. Implement and verify

## 3. Web

- [x] 3.1 Write a failing unit test that `approvalText` names «2/3». Implement and verify
- [x] 3.2 Add «2/3» to the mesa rule selector, and verify with a mocked E2E test that the request carries `two_thirds`
- [x] 3.3 Verify with a mocked E2E test that the phone ballot shows no approval rule before voting
- [x] 3.4 Verify with mocked E2E tests that the results, projector and acta show «2/3» and the votes needed

## 4. Docs and verification

- [x] 4.1 Update the 2/3 row and the decision rules in `docs/rules.md`, `docs/scope.md`, and the API and data model docs, leaving the 3/4 wording as it is
- [x] 4.2 Add a real-stack E2E test for a 2/3 decision
- [ ] 4.3 Run `npm run typecheck`, API tests with `TEST_DATABASE_URL`, `npm run test:e2e` and `npm run test:e2e:integration`, and verify all pass
