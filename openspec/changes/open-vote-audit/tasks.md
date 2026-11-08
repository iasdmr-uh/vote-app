## 1. API

- [x] 1.1 Failing tests: «Presentar oficiales», registering an election and retrying the cleanup are refused during an open vote and work after it
- [x] 1.2 Refuse them in `presentation.service.ts`, `official-roster.service.ts` and the cleanup retry
- [x] 1.3 Failing test: every preparation action is refused during an open vote and works after it ends
- [x] 1.4 Refuse them in `VotingService`

## 2. Console

- [x] 2.1 One `voteOpen` check in `useMesa.ts`
- [x] 2.2 Hide «Presentar oficiales» and «Reintentar limpieza» during a vote, with E2E checks
- [x] 2.3 E2E: the mesa shows no preparation control during a vote

## 3. Docs

- [x] 3.1 `docs/scope.md` section 8 rule 5
