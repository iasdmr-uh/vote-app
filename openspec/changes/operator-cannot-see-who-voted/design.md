## Context

Commit d17388a already removed the per-person dots from the participant list. The API still returns `voted` on each participant and on the regional secretary, and the console still derives «falta/faltan» from it and shows «Votó/Falta» for the secretary.

## Decisions

- **Remove the field at the source.** `moderatorAssembly` stops reading participation receipts per person. It keeps `attendanceRound` with `votedCount` and `eligibleCount`, which come from counting receipts. Hiding the field only in the web client would leave it in the API.
- **Disabled count.** The console summary keeps a count of disabled delegates, from `votingDisabled`. It no longer subtracts those who voted, because that needs the per-person flag.
- **Refusal check.** `setVotingDisabled` (disable and re-enable) and `changeRoomPresence` (take-out) check for an open round inside the existing transaction, after the assembly row lock, as `returnToRoom` already does. The error is a 409 Conflict with a Spanish message.
- **Console.** «Inhabilitar», «Habilitar» and «Retirar de la sala» are hidden while a vote is open, so the operator is not offered a refused action.

## Findings

- `voting-disabled.integration.spec.ts` expects disabling and re-enabling to work during an open vote. Its expected results change to refusals, per the requirement on actions during an open vote.

- `docs/principles.md` is not on `base/voting-core`, so its update cannot happen in this change. It belongs with the PR that adds that file.
- `participation.count` events still let the operator see the count rise in real time. #80 does not list it yet. It belongs in that list of limits.
