## 1. Who voted

- [ ] 1.1 Failing API tests: moderator state has no per-person `voted` for participants or the regional secretary, open or closed, and keeps `votedCount` and `eligibleCount`
- [ ] 1.2 Failing API test: an open round carries no counts per option in the moderator state
- [ ] 1.3 Remove the per-person flag from `moderatorAssembly`
- [ ] 1.4 Update tests that asserted the flag, per #55
- [ ] 1.5 Console: remove «Votó/Falta» for the secretary and the «falta/faltan» count; keep the disabled count

## 2. Actions during an open vote

- [ ] 2.1 Failing API tests: disable and take-out are refused while a vote is open, for a delegate and for the regional secretary, and work between votes
- [ ] 2.2 Add the open-round check to `setVotingDisabled` (disable) and to take-out
- [ ] 2.3 Console hides «Inhabilitar» and «Retirar de la sala» while a vote is open
- [ ] 2.4 E2E: the menu has no «Inhabilitar» or «Retirar de la sala» while a vote is open

## 3. One vote per person

- [ ] 3.1 Confirm existing tests cover a second ballot refused and a repeat after annulment; add any that are missing

## 4. Docs

- [ ] 4.1 `docs/scope.md` sections 9 and 18 and section 8 rule 15 match these requirements

## 5. Verify

- [ ] 5.1 `npm run db:generate --workspace @asdmr/api`, `npm run typecheck`, API tests with `TEST_DATABASE_URL`, `npm run test:e2e`, `npm run test:e2e:integration`
