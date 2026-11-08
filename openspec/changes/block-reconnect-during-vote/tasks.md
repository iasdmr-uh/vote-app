## 1. API

- [x] 1.1 Failing tests: issuing a code during an open vote is refused with no audit event
- [x] 1.2 Failing tests: redeeming an earlier code during an open vote is refused, the old token still works, and the code works after close and after annulment
- [x] 1.3 Failing test: issuing a code for the regional secretary is refused
- [x] 1.4 Test: a session token keeps working during an open vote
- [x] 1.5 Add the open-vote check to `issueResumeCode` and `redeemResumeCode`, and refuse the secretary in `issueResumeCode`
- [x] 1.6 Failing test: joining with the assembly code during an open vote is refused with a message to wait, and works after annulment once check-in reopens
- [x] 1.7 Refuse joins during an open vote in `joinAssembly`
- [x] 1.8 Failing test: changing the assembly code during an open vote is refused with no event or audit, and works after close
- [x] 1.9 Refuse `rotateJoinCode` during an open vote
- [x] 1.10 Restore the check that a reconnected session cannot vote again in a round it already voted in

## 2. Console

- [x] 2.1 Hide «Reconectar dispositivo» while a vote is open and on the secretary's row, with E2E checks
- [x] 2.2 E2E: the phone shows the wait message when a join is refused
- [x] 2.3 Hide the participant menu and «Nuevo código» while a vote is open, with E2E checks
- [x] 2.4 E2E: a refused reconnection scan tells the person to scan again when the vote ends

## 3. Docs

- [x] 3.1 `docs/scope.md` section 8 rule 15

## 4. Secretary entry QR

- [x] 4.1 Refuse the secretary's unused entry QR during an open vote (owner decision, 8 November 2026)

## 5. Verify

- [ ] 5.1 Full suites in the single final validation before #95
