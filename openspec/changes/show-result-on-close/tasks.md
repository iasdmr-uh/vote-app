## 1. Show the result on close

- [x] 1.1 Failing service tests: closing a vote whose separation succeeds makes it `published` and emits `results.published` once, to every room
- [x] 1.2 Failing service test: when separation fails the vote stays `closed`, no screen state carries counts, and a successful retry makes it `published`
- [x] 1.3 Failing test: the mesa state carries no counts for a `closed` vote
- [x] 1.4 Show closed rounds automatically after separation in `closeRound`, the cleanup retry and startup cleanup
- [x] 1.5 Remove `publishRound`, its route and `privateResults`

## 2. Final result and who goes on

- [x] 2.1 Migration: `settled_round_id`, `approved` and `registered_at` on `official_results`
- [x] 2.2 Failing tests: a settling vote records `settled_round_id`, a decision records `approved`, and an A favor / En contra decision gets a row
- [x] 2.3 Failing tests: public, participant and mesa state say final and list everyone elected in the election, or list who goes to the next vote
- [x] 2.4 Record settlement in `settleElection` and clear it on annulment
- [x] 2.5 Expose final, approved and next-vote candidates in the public, participant and mesa state

## 3. Official roster

- [x] 3.1 Failing tests: registering adds every elected of the election together, refuses unsettled, pending and annulled results, and repeats without change
- [x] 3.2 Failing integration tests: the database refuses to change `registered_at`, to change a registered result's options, and to annul a vote of a registered election, while «Borrar datos» still deletes everything
- [x] 3.3 Add the register endpoint, the service method and the triggers
- [ ] 3.4 After #79 lands, rebase and log registering with kind «Resultados»
- [x] 3.5 Failing test, then change: «Presentar oficiales» shows only registered results

## 4. Gates

- [x] 4.1 Failing tests: opening a vote of another election is refused while an election is pending, and allowed for its own runoff, after annulment and after registering
- [x] 4.2 Failing tests: annulment is refused once the next vote of the election opened or the election is registered
- [x] 4.3 Add both checks under the existing locks

## 5. Web

- [ ] 5.1 Failing E2E tests: phones, projector and mesa show «Preparando el resultado», then the result together
- [ ] 5.2 Failing E2E tests: final wording, decision wording, next-vote wording and the annulled state
- [ ] 5.3 Failing E2E test: the mesa adds a final result to the roster, then sees it marked and loses the action
- [ ] 5.4 Remove «Publicar resultados», add «Agregar a oficiales» with a confirmation that names the elected, and add the new states to all three views

## 6. Docs and verification

- [ ] 6.1 Update `docs/scope.md` sections 6, 7 and 14 and section 8 rules 8, 9 and 16
- [ ] 6.2 Update principles P4 and P5 in `docs/principles.md`
- [ ] 6.3 Update `docs/foundation/state-transitions.md` and `docs/foundation/api-and-events.md` for the removed publish step and the roster
- [ ] 6.4 Run `db:generate`, `typecheck`, API tests on a disposable database, `test:e2e` and `test:e2e:integration`
- [ ] 6.5 Scan the branch diff for added code comments
