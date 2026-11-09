# Principles

**Status:** DRAFT, not yet approved

Every spec in `openspec/specs/` answers to these principles. A requirement that breaks one needs an explicit human decision.

Sources marked § or "Rule" refer to `docs/scope.md`.

## P1. The Reglamento outranks the app

The app does not determine quorum, interpret rules or proclaim anyone elected.

- **Source:** §13

## P2. Ballots are secret

No screen or function shows who voted for what. The mesa sees how many voted, never who. A stored vote carries no voter ID.

- **Source:** §9, issue #55
- **Accepted limit:** someone who controls the database and logs could still try to link votes by timing. "Secret" does not mean cryptographically anonymous.
- **Accepted limit:** when the regional secretary's vote breaks a tie, such as 5-5 becoming 6-5, the arithmetic can reveal their vote.

## P3. One vote per session per ballot

A session casts at most one vote on a ballot. A confirmed vote cannot change.

- **Source:** Rule 6
- **Accepted limit:** this is one vote per session, not per person. One person could join from two phones or under another name. In-person checks are the only control.

## P4. The mesa never chooses winners

The mesa opens, closes, publishes and annuls. The app calculates the result.

- **Source:** Rule 9

## P5. Counts stay hidden until close, results until publish

Nobody sees counts while a ballot is open. The public sees results only after the mesa publishes.

- **Source:** Rule 8

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

Phones can reconnect, and the mesa can move to paper.

- **Source:** `docs/foundation/decisions-pending.md`, which states this less firmly
- **UNCONFIRMED:** needs a decision by the mesa

## Open questions

- **Election date:** not yet recorded. It decides how much of the backfill fits before the election.
