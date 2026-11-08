# Testing

**Status:** DRAFT, not yet approved

## Runners

| Runner | Used for |
|---|---|
| `node:test` with `tsx` | API and web unit, integration and HTTP tests |
| Playwright | End-to-end tests |
| k6 | Load tests |

- Vitest is added to `apps/web` only when a Vue component needs testing on its own.
- `mock.module`, watch mode and coverage are experimental in `node:test`, so tests and CI do not depend on them.

## Levels

| Level | Folder | Calls | Proves | Runs in |
|---|---|---|---|---|
| Unit | `apps/api/test/unit/`, `apps/web/test/unit/` | Pure functions | Election rules and display helpers | Local, CI |
| Integration | `apps/api/test/integration/` | `VotingService` on PostgreSQL | Stored state, locks and vote secrecy | Local, CI |
| HTTP | `apps/api/test/http/` | Nest in the test process, through `fetch` | Access, request validation and the moderator channel | Local, CI |
| Scenarios | `tests/scenarios/` | Data replayed by other levels | Whole sessions give the same result at every level | With the level that replays them |
| Mocked end-to-end | `tests/e2e/mocked/` | The browser, with the API intercepted | What each screen shows | Local, CI |
| Real-stack end-to-end | `tests/e2e/real-stack/` | The browser, API and PostgreSQL | Flows across the phone, mesa and projector | Local only |
| Load | `tests/load/` | k6 against a running stack | 50 to 70 concurrent sessions | Local only |

## Choosing a level

| The change touches | Test it at |
|---|---|
| A counting, majority or tie rule | Unit, and a scenario when it spans several votes |
| Stored state, locks or vote unlinking | Integration |
| Who may call an endpoint, or what it rejects | HTTP |
| What a screen shows | Mocked end-to-end |
| A flow across screens | Real-stack end-to-end, sparingly |

## Anatomy

| Rule | Source |
|---|---|
| Each test checks one behavior | Meszaros, Eager Test; Google ch. 12 |
| A test name states the unit, the scenario and the expected result | Goldberg 1.1 |
| Arrange, Act and Assert are separate blocks, split by a blank line | Goldberg 1.2 |
| A test shows only the setup that matters to it, and helpers in `support/` build the rest | Meszaros, Obscure Test; Pryce, Test Data Builder |
| Readable repetition beats clever sharing | Google ch. 12, DAMP |
| `describe` groups tests by unit or story | Goldberg 1.12 |
| Data looks real, with Spanish names and real offices | Goldberg 1.6 |
| Errors are expected with `assert.rejects` or `assert.throws`, never caught | Goldberg 1.10 |
| Collaborators come in through the constructor, replaced by stubs or spies | Goldberg 1.5 |
| Tests never sleep, and wait for events or advance `page.clock` | Goldberg 3.4 |
| Time and randomness are arguments, and shuffles take a seed | `CLAUDE.md`, Algorithms |
| Edge cases are covered: zero votes, no candidates, everyone tied, more seats than candidates, abstention | `CLAUDE.md`, Algorithms |
| Invariants are asserted as well as examples | `CLAUDE.md`, Algorithms |

Example name:

```ts
test('electionOutcome: a tie at the last seat sends only the tied candidates to a runoff', () => {})
```

## Data

- Each test creates its own records. (Goldberg integration 6.1)
- Only reference data is seeded ahead of time. (Goldberg integration 6.2)
- Each test removes its own records when it ends. (Goldberg 2.8)
- Unique fields get a random suffix. (Goldberg integration 6.5)
- The integration script fails when `TEST_DATABASE_URL` is missing.

## Outcomes to check

A command can change four things, and its tests check each one that applies. (Goldberg 2.12)

| Outcome | Example check |
|---|---|
| The response | The vote returns `recorded` |
| Stored state | One `Participation` and one `AnonymousVote` exist |
| Realtime events | `assemblyState` is emitted after commit |
| Logs | No selection, token or session id appears |

## Scenarios

- A new election rule starts as a fixture in `tests/scenarios/`.
- The unit, integration and real-stack levels replay the same fixture and expect the same result.
- Fixtures include abstentions.
- Source: Adzic, Specification by Example.

## End-to-end

- Locators use roles and labels. (Playwright, Locators)
- Each test is isolated from the others. (Playwright, Test isolation)
- Mocked tests declare API responses through a shared fixture.
- Real-stack tests call the API only to set up and to read back stored state.
- Real-stack tests stay few. (Goldberg 3.7)

## Commands

| Command | Runs | Needs |
|---|---|---|
| `npm test` | Unit tests | Nothing |
| `npm run test:integration` | Integration and HTTP tests | `TEST_DATABASE_URL` |
| `npm run test:e2e` | Mocked end-to-end | Playwright browsers |
| `npm run test:e2e:real-stack` | Real-stack end-to-end | Docker or local PostgreSQL |
| `npm run test:load` | Load test | k6 and a running stack |

## Sources

- Goldberg, JavaScript Testing Best Practices: https://github.com/goldbergyoni/javascript-testing-best-practices
- Goldberg, Node.js Integration Tests Best Practices: https://github.com/testjavascript/nodejs-integration-tests-best-practices
- Meszaros, xUnit Test Patterns
- Pryce and Freeman, Growing Object-Oriented Software, Guided by Tests
- Winters, Manshreck and Wright, Software Engineering at Google, ch. 12
- Adzic, Specification by Example
- Playwright best practices: https://playwright.dev/docs/best-practices
