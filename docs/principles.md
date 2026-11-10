# Principles

**Status:** Approved, 10 Nov 2026

Every spec in `openspec/specs/` answers to these principles. A requirement that breaks one needs an explicit human decision.

Sources marked § or "Rule" refer to `docs/scope.md`.

## P1. The Reglamento outranks the app

The app does not determine quorum. It counts by the Reglamento's rules as written in `docs/rules.md`. Every decision about a result is made by the Assembly, outside the app.

- **Source:** §13, maintainer decision, 10 Nov 2026

## P2. Ballots are secret

No screen or function shows who voted for what. The Presiding Board and the Operator see how many voted, never who. A stored vote carries no voter ID.

- **Source:** §9, issue #55
- **Accepted limit:** someone who controls the database and logs could still try to link votes by timing. "Secret" does not mean cryptographically anonymous.
- **Accepted limit:** when the regional secretary's vote breaks a tie, such as 5-5 becoming 6-5, the arithmetic can reveal their vote.

## P3. One vote per session per ballot

A session casts at most one vote on a ballot. A confirmed vote cannot change.

- **Source:** Rule 6
- **Accepted limit:** this is one vote per session, not per person. One person could join from two phones or under another name. In-person checks are the only control.

## P4. No person chooses a winner

The Presiding Board leads, the Assembly decides and the Operator acts in the app. The Operator opens, closes, publishes and annuls votes. The app counts.

- **Source:** Rule 9, maintainer decision, 10 Nov 2026

## P5. Counts stay hidden while a vote is open, results stay preliminary until published

Nobody sees counts or who is ahead while a vote is open. After close, the result is shown as preliminary so the Assembly can validate it. The Presiding Board asks the Assembly every time, and the Operator publishes the result as official or annuls it, as the Assembly decides.

- **Source:** Rule 8, maintainer decisions, 9 and 10 Nov 2026
- **Gap:** the app does not hold results at preliminary yet. #132 tracks it.

## P6. People verify who is present

A name is not a credential. Eligibility stays a human decision.

- **Source:** §9, Rule 9

## P7. The server enforces every rule

PostgreSQL is the source of truth. Phones and screens cannot override the server.

- **Source:** `docs/adr/ADR-001-architecture.md`

## P8. Administrative actions are recorded

The record never links a person to their choice.

- **Source:** §6

## P9. Failure is survivable

Phones can reconnect. Any vote can be abandoned. The Operator annuls it on the Assembly's decision, and it is repeated on paper or in the app. Paper is the official fallback.

- **Source:** maintainer decision, 9 Nov 2026
