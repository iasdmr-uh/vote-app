## Why

Amending the Estatutos needs 2/3 of the Assembly's votes, and the tool cannot run that vote today. The mesa can only choose simple majority or 3/4 for a decision. Issue: #87.

## What Changes

- The mesa can choose «2/3» as the approval rule when it prepares a decision, next to «Mayoría simple» and «3/4».
- A 2/3 decision needs at least 2/3 of the base, rounded up. The base is everyone in the room when voting opens, abstentions included, the same base the other rules use. 28 in the room needs 19.
- Delegates see «2/3» and the votes needed before they vote.
- Results, the public screen and the acta name 2/3 and the votes needed.
- The database accepts only the three known approval rules.
- Elections are not affected.

## Capabilities

### New Capabilities

- `decision-approval-rule`: which approval rules a decision can use, how many votes each needs, and where the rule is shown.

### Modified Capabilities

None.

## Impact

- API results engine: a third threshold rule.
- API round creation: accept `two_thirds` for decisions only.
- Database: a check constraint on `rounds.approval_rule`.
- API participant state: the votes needed for the open decision.
- Web: the mesa selector, the phone ballot and the shared rule text.
- Docs: the 2/3 row and decision rules in `docs/rules.md`, the API docs and the data model.
- Related: #54, #59.
