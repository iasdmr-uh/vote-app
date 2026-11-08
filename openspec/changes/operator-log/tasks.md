## 1. Log catalogue and rendering

- [ ] 1.1 Write failing unit tests for the catalogue: kind per action, Spanish wording with and without `personName`, annulment reason, download purpose, unknown actions left out
- [ ] 1.2 Write failing unit tests for the CSV: byte order mark, quoting, formula escaping, Honduras time, order by time then sequence
- [ ] 1.3 Implement `apps/api/src/voting/operator-log.ts` until the tests pass

## 2. Database

- [ ] 2.1 Add a migration with `audit_events.sequence BIGSERIAL` and the Prisma field

## 3. Write sites

- [ ] 3.1 Write failing integration tests that taking out, re-admitting, disabling, enabling, correcting, removing and «Reconectar dispositivo» store the person's name at the time
- [ ] 3.2 Add `personName` to those write sites in `voting.service.ts`
- [ ] 3.3 Write a failing integration test that redeeming a «Reconectar dispositivo» code adds no entry, then stop writing it

## 4. Download and gate

- [ ] 4.1 Write failing integration tests for the download: its own entry is last, `entryCount` matches, purpose is kept, the file holds no participant ids or choices
- [ ] 4.2 Write failing integration tests for the gate: no download, plain download, download then erase, action after download
- [ ] 4.3 Implement the download endpoint and the gate in `deleteAssemblyData`

## 5. Web

- [ ] 5.1 Write a failing mocked E2E test for «Descargar registro» and for «Borrar datos» downloading first
- [ ] 5.2 Add the button and the download step in `Mesa.vue` and `useMesa.ts`

## 6. Docs and verification

- [ ] 6.1 Update `docs/foundation/data-model.md` and `docs/foundation/api-and-events.md` for the log, the download and the gate
- [ ] 6.2 Run `db:generate`, typecheck, API tests with `TEST_DATABASE_URL`, `test:e2e` and `test:e2e:integration`
