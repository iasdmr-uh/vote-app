## 1. API

- [x] 1.1 Failing tests: issuing a code during an open vote is refused with no audit event
- [x] 1.2 Failing tests: redeeming an earlier code during an open vote is refused, the old token still works, and the code works after close and after annulment
- [x] 1.3 Failing test: issuing a code for the regional secretary is refused
- [x] 1.4 Test: a session token keeps working during an open vote
- [x] 1.5 Add the open-vote check to `issueResumeCode` and `redeemResumeCode`, and refuse the secretary in `issueResumeCode`

## 2. Console

- [x] 2.1 Hide «Reconectar dispositivo» while a vote is open and on the secretary's row, with E2E checks

## 3. Docs

- [x] 3.1 `docs/scope.md` section 8 rule 15

## 4. Secretary entry QR

- [x] 4.1 Refuse the secretary's unused entry QR during an open vote (owner decision, 8 November 2026)

## 5. Verify

- [ ] 5.1 Full suites in the single final validation before #95
