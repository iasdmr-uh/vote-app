## Context

Commit d17388a already removed the per-person dots from the participant list. The API still returns `voted` on each participant and on the regional secretary, and the console still derives «falta/faltan» from it and shows «Votó/Falta» for the secretary.

## Decisions

- **Remove the field at the source.** `moderatorAssembly` stops reading participation receipts per person. It keeps `attendanceRound` with `votedCount` and `eligibleCount`, which come from counting receipts. Hiding the field only in the web client would leave it in the API.
- **Aggregate summary.** The console counts disabled delegates from `votingDisabled` and computes «falta/faltan» as `eligibleCount − votedCount − disabled`. This holds because nobody can be disabled or re-enabled during an open vote, so a disabled delegate never has a receipt in that vote.
- **Refusal check.** `setVotingDisabled` (disable and re-enable) and `changeRoomPresence` (take-out) check for an open round inside the existing transaction, after the assembly row lock, as `returnToRoom` already does. The error is a 409 Conflict with a Spanish message.
- **Console.** «Inhabilitar», «Habilitar» and «Retirar de la sala» are hidden while a vote is open, so the operator is not offered a refused action.

## Findings

- `voting-disabled.integration.spec.ts` expects disabling and re-enabling to work during an open vote. Its expected results change to refusals, per the requirement on actions during an open vote.
- `docs/principles.md` had an open question on whether the mesa sees who voted. #55 settles it, so P2 now covers it and the question is gone.
- `participation.count` events still let the operator see the count rise in real time. #80 does not list it yet. It belongs in that list of limits.
