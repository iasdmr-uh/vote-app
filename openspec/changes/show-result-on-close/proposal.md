## Why

Today the operator sees each result first and decides when to publish it. Issue #76 asks that nobody gets an earlier look, the operator included. The room checks each result itself before the election moves on, and the vote that settles an election goes on an official roster that cannot be undone in the tool.

## What Changes

- **BREAKING** Closing a vote shows its result on the phones, the public screen and the operator console at once. The «Publicar resultados» action and its endpoint go away.
- No screen shows a result until the votes are separated from the voters. Until then every screen says the result is being prepared, and the operator can retry.
- The operator console stops receiving a closed vote's counts before the public screen does.
- A result stays on every screen until the operator opens the next vote.
- A vote that does not settle its election shows who goes to the next vote. The operator opens that vote.
- A vote that settles its election says final and lists everyone elected in the election. A decision says approved or not approved.
- New: the operator adds a final result to the official roster in one action. A roster entry cannot be undone in the tool.
- No vote of another election or decision opens while an election has a result that is not on the roster and not annulled.
- Annulment is allowed until the next vote of the election opens or the result goes on the roster.
- «Presentar oficiales» shows only what is on the official roster.
- `docs/scope.md` and `docs/principles.md` stop saying the operator sees results first or publishes them.

## Capabilities

### New Capabilities

- `result-flow`: when and where a vote's result appears, what it says, how long it stays, when a vote can be annulled, and when another election may open.
- `official-roster`: adding a final result to the official roster, its permanence, and what «Presentar oficiales» shows.

### Modified Capabilities

None. `openspec/specs/` has no specs yet.

## Impact

- API: `closeRound` and the cleanup retry show the result. `publishRound` and `POST /moderator/rounds/:roundId/publish` are removed. A new moderator endpoint adds a result to the roster. `openRound` and `annulRound` gain checks.
- Database: `official_results` records the vote that settled the election, a decision's outcome and when the result went on the roster. A trigger keeps a roster entry from changing.
- Realtime: the result notice reaches every room in one emit after the commit. A roster notice tells clients to refetch.
- Web: all three views gain the «being prepared» state and the final or next-vote wording. The mesa loses «Publicar resultados» and gains the roster action.
- Operator log (#79): adding to the roster is logged with kind «Resultados». This lane rebases on #79 before building that part.
- Followed by #86, which defines the result table on this flow. #83 relies on closing showing the result by itself.
- Source issue: #76. Related: #55, #79, #83, #84, #86.
