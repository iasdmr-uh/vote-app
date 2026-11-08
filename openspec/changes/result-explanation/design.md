## Context

- `results-engine.ts` returns `seats`, `base`, `threshold`, `elected`, `runoff` and `openSeats`. Decisions add `rule` and `approved`. Elections carry no rule.
- The engine knows each option's reason while it computes, through the cut, the tie at the cut and the added runner-up, but it does not report the reason.
- `freezeRoundBase` stores `eligibleCount` when a vote opens. It does not store whether the regional secretary is part of that count.
- The participant, public and mesa states already carry `outcome` and the round's `regionalSecretaryVotes`.
- `resultados.ts` already turns outcomes into Spanish labels, such as `majorityText`, `approvalText` and `formatNames`.

## Goals / Non-Goals

**Goals:**

- Report the rule, the base composition and a reason per option with every outcome, from the server.
- Show one paragraph per result on the mesa and the projector, from those facts only.

**Non-Goals:**

- Changing any counting rule or who continues.
- The acta, result rows, percentages and «No votaron» (#86).
- Moving on-screen text to a locale file. That happens after the split PR.
- Any change to the phone. The phone is only a device to vote and shows no results, as the user decided on 8 Nov 2026. A separate change removes the phone results.
- Anything that acts during an open vote. The explanation appears only after a vote closes.

## Decisions

### D1. The engine reports the rule and the reasons

- The engine classifies each option once, as `elected`, `tied_at_cut`, `no_majority`, `added_for_choice` or `out`. `electionOutcome` and a new `electionReasons` both read that classification, so they never disagree.
- The outcome keeps its current shape. The states carry a separate `explanation` object with `rule`, `reasons` and the base composition, so existing outcome expectations stay as they are.
- An A favor / En contra decision reports empty `reasons`, because `approved` already says everything.
- Alternative: derive reasons on the web from `elected`, `runoff` and the counts. Rejected because #58 forbids screens from working out a result, and the tie-at-cut versus no-majority split needs the engine's cut.

### D2. The round records the secretary at freeze

- New column `rounds.regional_secretary_in_base`, a nullable boolean, set by `freezeRoundBase` in the same update as `eligible_count`.
- The public and mesa states report `baseDelegates` and `baseIncludesSecretary` next to `outcome`. The participant state does not, because the phone shows no explanation. For rounds frozen before the migration, the column is null and the states fall back to `regionalSecretaryVotes`.
- Alternative: infer from `regionalSecretaryVotes` alone. Rejected because the secretary can be inactive when the vote opens, and then the base does not include them.

### D3. One web helper builds the paragraph

- `explanationText(target, outcome, explanation, results)` in `resultados.ts` returns the paragraph from the spec. It reads the base and threshold from the outcome, the rule, reasons and base composition from the explanation, and the labels and counts from the rows.
- Each screen calls it. None of them repeats the wording.

### D4. A toggle in the mesa, a line on the projector

- A small `ResultExplanation.vue` renders a button with `aria-expanded` and the paragraph below it. Both mesa result cards use it.
- The projector renders the same paragraph as a plain line under the majority line.
- The phone does not import the helper or the component.

## Risks / Trade-offs

- The paragraph gets long on a committee with many candidates. Out options are not listed, which keeps it to the elected and the continuing.
- «habilitados» differs from #58's example «elegibles». The change follows the other screens and records the choice in the spec.
- A migration lands after #95. The column is nullable, so older rounds keep working.
