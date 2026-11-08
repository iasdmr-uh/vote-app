## Context

- `results-engine.ts` defines `ThresholdRule` as `'simple' | 'three_quarters'`. `thresholdVotes` and `meetsThreshold` are the only places that turn a rule into a vote count.
- `rounds.approval_rule` is a text column with default `'simple'` and no check constraint.
- `openRound` freezes the base in `rounds.eligible_count`. Decisions and elections share that base.
- `approvalText` in `resultados.ts` names the rule for the results, the projector slides, the acta and the mesa record.

## Goals / Non-Goals

**Goals:**

- Add 2/3 as a third rule with one formula in one function.
- Show the rule and the votes needed wherever 3/4 is shown today.

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

### Phone stays minimal

The phone ballot shows no rule before voting, by the user's decision of 8 Nov 2026. The mesa explains the rule out loud, and the results show how the outcome was counted. The API state needs no new field, because results already carry `outcome.threshold`.

### Shared rule label

`approvalText` maps `two_thirds` to «2/3». The results, projector, acta and mesa record all pick it up.

## Risks / Trade-offs

- [Delegates do not see the votes needed before voting] → The mesa states the rule out loud, and the results name it. #54's ask is declined for the phone by the user's decision of 8 Nov 2026.
