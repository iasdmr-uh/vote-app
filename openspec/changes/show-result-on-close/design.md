## Context

Today a closed vote is computed at close, hidden from everyone but the mesa, and shown when the mesa presses «Publicar resultados». The results engine writes the elected into `official_results` of the election's first vote at close. «Presentar oficiales» reads those rows for published votes. The mesa can annul the latest vote of an election in any state.

Issue #76 removes the operator's early look and the publish step, adds an official roster the operator fills on the Presiding Officer's word, and gates other elections on it. Lanes for #79 and #55 also edit `voting.service.ts`, and they merge first, so this change keeps its edits there small and local.

## Goals / Non-Goals

**Goals:**

- Show each result on every screen at once, as soon as its votes are separated from the voters.
- Give the operator one action that puts a final result on the roster, and make that entry permanent.
- Gate other elections and annulment on the roster.

**Non-Goals:**

- The result table layout, ordering and «No votaron» row. #86 does that on top of this change.
- Closing a vote by itself. #83 does that and relies on this flow.
- Changing the acta.
- Changing who goes to a runoff or who is elected. The results engine stays as it is.

## Decisions

### D1. Keep `published` and set it automatically

A round still moves `closed → published`, but the system makes the move as soon as its votes are separated from the voters. No operator action triggers it.

- One function shows every closed round of the assembly whose `votes_unlinked_at` is set. It sets `published`, then emits.
- `closeRound`, the cleanup retry and startup cleanup call it after the separation succeeds.
- `publishRound`, its controller route and the mesa button go away.

Alternative: drop the `published` status and treat `closed` with `votes_unlinked_at` as shown. Rejected because phones, projector, acta and filters already key on `published`, and the enum change would touch far more code.

### D2. One gate for every audience

Phones, projector and mesa read a vote's counts only when it is `published`. The mesa's `privateResults` for `closed` rounds goes away. The `results.published` notice already reaches all rooms in one call after the commit, so the screens get it together.

### D3. The roster lives on `official_results`

New nullable columns on `official_results`:

| Column | Meaning |
|---|---|
| `settled_round_id` | The vote that settled the election. Null while seats are open or a runoff is pending |
| `approved` | A decision's outcome. Null for elections |
| `registered_at` | When the operator added it to the roster |

- Settling writes the row even when nobody is elected, so an A favor / En contra decision gets one.
- Annulling the settling vote clears `settled_round_id` together with that vote's elected, which the current annulment already removes.
- `POST /moderator/elections/:rootRoundId/register` sets `registered_at`. It refuses when `settled_round_id` is null, when that round is not `published`, or when the round is annulled. Repeating the call on a registered result changes nothing.
- `OfficialRosterService` owns registering, apart from `VotingService`.
- Registering is refused once the assembly is completed, like every other result change. UNCONFIRMED.

Alternative: a separate roster table copying the elected. Rejected because the elected already live on `official_results`, and a copy can drift.

### D4. Database guard for the roster

Triggers refuse these changes to a registered result:

- changing `registered_at` or `approved`
- deleting the `official_results` row
- inserting or deleting its `official_result_options`
- moving a round of the election to `annulled`

«Borrar datos» still deletes everything. The delete guards let a delete through when the parent round or ballot option is already gone, which is what the cascade does. A test covers it.

### D5. Election gate in `openRound`

Under the assembly lock `openRound` already takes, an election is pending when its latest vote that is not a draft is `closed` or `published` and its `registered_at` is null. Opening a vote refuses when any pending election has another root. A runoff or repeat of the same election passes.

### D6. Annulment window

`annulRound` keeps its current check that no later vote of the election is open or settled. It adds a refusal when the election's `registered_at` is set.

### D7. «Presentar oficiales»

`positionsOf` filters by `registered_at` instead of round status, for the projector and the mesa alike, so the mesa preview matches the projector.

### D8. Operator log

Registering writes one audit event with kind «Resultados» through the helper #79 adds. This lane rebases on #79 before building that task.

### D9. Screen wording

Proposed Spanish text, UNCONFIRMED until the coordinator or the user confirms it:

| State | Text |
|---|---|
| Separation pending | «Preparando el resultado» |
| Vote did not settle | «Pasan a la siguiente votación» |
| Vote settled an election | «Resultado final» and «Electos» |
| Vote settled a decision | «Resultado final» and «Aprobada» or «No aprobada» |
| Roster action | «Agregar a oficiales» |
| On the roster | «Registrado como oficial» |

## Findings

Mismatches between this spec and the current code:

- The mesa receives `privateResults` for closed rounds before anyone else sees them.
- Results need the operator's «Publicar resultados».
- The mesa's positions show the elected of closed, unpublished votes.
- Annulment is allowed in any state, with no roster limit.
- An A favor / En contra decision writes no `official_results` row.
- Any vote can open while another election waits on a runoff.

## Risks / Trade-offs

- [The assembly runs today and the flow changes for the operator] → Nothing deploys from this branch. The change waits for the next assembly.
- [Three lanes edit `voting.service.ts`] → Merge order is #79, #55, then this lane. Edits stay inside the functions they change.
- [A stuck separation leaves every screen on «being prepared»] → The retry exists today and stays. The operator can still annul.
- [Assembly completion with an election not on the roster] → Not covered by #76. Completion keeps its current checks.

## Migration Plan

One Prisma migration adds the three columns and the triggers. Existing rows keep null values. No backfill is needed, because no assembly data survives between assemblies.
