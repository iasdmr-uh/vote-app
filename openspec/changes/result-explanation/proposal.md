## Why

People in the room need to check a result by hand and not take the tool's word for it. Today a result shows the votes per option and the votes needed, but it does not name the rule for an election, does not say why each candidate ended where they did, and does not show that the regional secretary is part of the base. Issues #57 and #58 ask for the rule, the numbers and the reason with every result.

## What Changes

- Every reported result names its rule («Mayoría simple», «2/3» or «3/4»), elections included.
- Every reported result carries the base and how it is made up, so a base with the regional secretary reads "29 (28 + secretaría regional)".
- Every option in an election, and in an Opciones decision, carries the reason it ended where it did: elected, tied at the cut, no majority, added so the next vote offers a choice, or out.
- The server reports these facts. Screens only turn them into Spanish text and never work out a result.
- The mesa shows an information button on every result, preliminary and final. It opens one short paragraph with this result's own numbers.
- The public screen shows the same paragraph as a fixed line.
- The phone gets no explanation. The user decided on 8 Nov 2026 that the phone shows only the voting controls and the projector communicates everything else, so #58's phone information button is declined.

## Capabilities

### New Capabilities

- `result-explanation`: what every result reports about its rule, base and per-option reasons, and how each screen explains it.

### Modified Capabilities

None. `openspec/specs/` has no specs yet.

## Impact

- API: the results engine reports the rule for elections and a reason per option. The public and mesa states carry the base composition.
- Database: rounds record whether the regional secretary was in the base when the base was frozen.
- Web: a new explanation helper in `resultados.ts`. `ModeratorPublishedBallot.vue` and `ModeratorVotingBallot.vue` gain the information button. `ProjectorResults.vue` gains the fixed line. Phone views are unchanged.
- Unchanged: counting rules, the acta, result rows and percentages (#86).
- Source issues: #57, #58. Related: #54, #59, #76, #86.
