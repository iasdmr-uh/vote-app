## 1. Engine reports the rule and the reasons

- [ ] 1.1 Failing engine tests for every reason scenario in the spec: elected, no majority, tied at the cut, added for choice, out
- [ ] 1.2 Failing engine tests: elections report «Mayoría simple», decisions report their rule, an A favor / En contra decision reports no reasons
- [ ] 1.3 Failing invariant tests: every option has one reason, the elected never exceed the seats, no option is both elected and continuing, and recomputing from rule, seats, base and counts gives the same outcome, including base 0
- [ ] 1.4 Add `rule` and `reasons` to the outcome in `electionOutcome` and `decisionOutcome`

## 2. Base records the regional secretary

- [ ] 2.1 Failing integration tests: freezing the base records whether the secretary is in it, and a secretary who leaves after the vote opens stays in the reported base
- [ ] 2.2 Migration: nullable `rounds.regional_secretary_in_base`, set by `freezeRoundBase`
- [ ] 2.3 Failing service tests: the public and mesa states report `baseDelegates` and `baseIncludesSecretary`, with the fallback for rounds frozen before the migration, and the participant state does not
- [ ] 2.4 Expose the base composition in the public and mesa states

## 3. Explanation text

- [ ] 3.1 Failing unit tests for `explanationText` from every paragraph scenario in the spec, including the secretary base and «1 voto»
- [ ] 3.2 Add `explanationText` to `resultados.ts`

## 4. Screens

- [ ] 4.1 Failing mocked E2E tests: a mesa result opens and closes the paragraph with its information button, for a preliminary and a final result
- [ ] 4.2 Failing mocked E2E test: the projector shows the paragraph as a fixed line with no button
- [ ] 4.3 Failing mocked E2E test: the phone shows no rule, paragraph or information button, open or closed
- [ ] 4.4 Add `ResultExplanation.vue` to both mesa result cards and the fixed line to `ProjectorResults.vue`

## 5. Verification

- [ ] 5.1 Real-stack E2E: a 2-seat committee chain with the regional secretary shows the paragraph on the projector and in the mesa
- [ ] 5.2 Update `docs/rules.md` and `docs/foundation/data-model.md` for the reasons and the new column
- [ ] 5.3 `openspec validate result-explanation --strict` passes
