## 1. Who voted

- [x] 1.1 Failing API tests: moderator state has no per-person `voted` for participants or the regional secretary, open or closed, and keeps `votedCount` and `eligibleCount`
- [x] 1.2 Failing API test: an open round carries no counts per option in the moderator state
- [x] 1.3 Remove the per-person flag from `moderatorAssembly`
- [x] 1.4 Update tests that asserted the flag, per #55
- [x] 1.5 Console: remove «Votó/Falta» for the secretary and compute «falta/faltan» and the disabled count from aggregates

## 2. Actions during an open vote

- [x] 2.1 Failing API tests: disable, re-enable and take-out are refused while a vote is open, for a delegate and for the regional secretary, and work between votes
- [x] 2.2 Add the open-round check to `setVotingDisabled` (disable and re-enable) and to take-out
- [x] 2.3 Console hides «Inhabilitar», «Habilitar» and «Retirar de la sala» while a vote is open
- [x] 2.4 E2E: the menu has no «Inhabilitar», «Habilitar» or «Retirar de la sala» while a vote is open

## 3. One vote per person

- [x] 3.1 Confirm existing tests cover a second ballot refused and a repeat after annulment; add any that are missing (covered by `voting.integration.spec.ts` and `annulment.integration.spec.ts`)

## 4. Docs

- [x] 4.1 `docs/scope.md` sections 9 and 18 and section 8 rule 15 match these requirements
- [x] 4.2 `docs/principles.md` P2 covers who voted

## 5. Verify

- [ ] 5.1 `npm run db:generate --workspace @asdmr/api`, `npm run typecheck`, API tests with `TEST_DATABASE_URL`, `npm run test:e2e`, `npm run test:e2e:integration`
