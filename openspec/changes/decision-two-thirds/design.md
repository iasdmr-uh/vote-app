## Context

- `results-engine.ts` defines `ThresholdRule` as `'simple' | 'three_quarters'`. `thresholdVotes` and `meetsThreshold` are the only places that turn a rule into a vote count.
- `rounds.approval_rule` is a text column with default `'simple'` and no check constraint.
- `openRound` freezes the base in `rounds.eligible_count`. Decisions and elections share that base.
- `approvalText` in `resultados.ts` names the rule for the results, the projector slides, the acta and the mesa record.
- The phone shows no rule before voting for any decision today.

## Goals / Non-Goals

**Goals:**

- Add 2/3 as a third rule with one formula in one function.
- Show the rule and the votes needed wherever 3/4 is shown today, and on the phone before voting.

**Non-Goals:**

- Changing 3/4 or simple majority.
- Approval rules for elections.
- Marking 3/4 as confirmed in the docs. Another change owns that wording.

## Decisions

### One more value of ThresholdRule

`ThresholdRule` gains `'two_thirds'`. `thresholdVotes` returns `ceil(2 × base / 3)`, at least 1, as it does for the other rules. Everything downstream already takes the rule as an argument, so `decisionOutcome` needs no change.

Alternative considered: a numeric fraction in the column. It would let the mesa pick any fraction, and the Reglamento names only fixed rules (#54).

### Check constraint on approval_rule

A migration adds `CHECK (approval_rule IN ('simple', 'three_quarters', 'two_thirds'))`. The DTO already rejects unknown values, and the database now rejects them too.

### Server sends the votes needed

The state the phone reads gains `approvalThreshold` for an open decision, computed with `thresholdVotes` over the frozen base. The phone shows «Se aprueba con 2/3 · 19 votos» from it. The phone does not restate the formula.

### Shared rule label

`approvalText` maps `two_thirds` to «2/3». The results, projector, acta and mesa record all pick it up.

## Risks / Trade-offs

- [Which decisions show the rule on the phone before voting] → #87 asks for 2/3, and #54 asks for every ballot. The user decides. This change shows 2/3 either way.
