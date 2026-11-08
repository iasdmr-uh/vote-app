## ADDED Requirements

### Requirement: Every result names its rule

Every reported result SHALL name the rule that decided it. Elections SHALL report «Mayoría simple». Decisions SHALL report the rule the mesa chose: «Mayoría simple», «2/3» or «3/4». A result SHALL NOT cite a Reglamento article or a decision date.

Source: #57, maintainer decision of 8 Nov 2026. The rules we were given are settled, so the tool names them without justifying them.

#### Scenario: Election

- **WHEN** an office election closes
- **THEN** its result names «Mayoría simple»

#### Scenario: 3/4 decision

- **WHEN** a decision under 3/4 closes
- **THEN** its result names «3/4» and carries no «sin confirmar» label

### Requirement: Every result reports its numbers

Every reported result SHALL carry the votes per option, the votes needed and the base. The base SHALL be the frozen base of that vote. Anyone SHALL be able to recompute the outcome from these numbers and the rule alone and get the same outcome.

Source: #57.

#### Scenario: Recompute an election

- **WHEN** any reported election result is recomputed from its rule, seats, base and votes per option
- **THEN** the recomputed votes needed, elected and continuing candidates equal the reported ones

#### Scenario: Recompute a decision

- **WHEN** any reported decision result is recomputed from its rule, format, base and votes per option
- **THEN** the recomputed votes needed and approval equal the reported ones

#### Scenario: Nobody in the room

- **WHEN** a vote closes with a base of 0
- **THEN** its result reports 1 vote needed

### Requirement: The base shows the regional secretary

When the regional secretary was part of a vote's base, the result SHALL say so and SHALL report the base as the delegates plus the secretary. Whether the secretary is in the base SHALL be recorded when the base is frozen, so later changes in the room do not alter it.

Source: #57, `docs/scope.md` rule 17.

#### Scenario: Secretary votes

- **WHEN** a vote opens with 28 delegates in the room and the regional secretary voting
- **THEN** its result reports a base of 29, made of 28 delegates and the secretaría regional

#### Scenario: Secretary leaves after the vote

- **WHEN** the regional secretary is in a vote's base and is taken out of the room after it closes
- **THEN** its result still reports the base as 28 delegates plus the secretaría regional

#### Scenario: Secretary does not vote

- **WHEN** a vote opens with 28 delegates and the regional secretary not voting
- **THEN** its result reports a base of 28 with no mention of the secretaría regional

### Requirement: Every option reports why it ended where it did

In an election and in an Opciones decision, the result SHALL give each option exactly one reason:

- **elected**: within the seats and with at least the votes needed. In an Opciones decision this is the approved option.
- **tied at the cut**: tied with others for the last seat, so the tie goes to the next vote.
- **no majority**: within the seats but short of the votes needed.
- **added for choice**: added to the next vote because the continuing candidates were not more than the open seats.
- **out**: none of the above.

An A favor / En contra decision SHALL report approved or not approved and no per-option reason.

Source: #57. The added-for-choice rule comes from the union representatives, 8 Nov 2026.

#### Scenario: Elected with a majority

- **WHEN** an office election has a base of 38 and Isaías gets 22, Jeremías 10 and Ezequiel 6
- **THEN** Isaías is elected, and Jeremías and Ezequiel are out

#### Scenario: No majority

- **WHEN** an office election has a base of 38 and Isaías gets 18, Jeremías 12 and Ezequiel 8
- **THEN** Isaías has no majority, Jeremías is added for choice, and Ezequiel is out

#### Scenario: Tied at the cut

- **WHEN** a 2-seat committee vote has a base of 38 and Isaías gets 22, Jeremías 8, Ezequiel 8 and Daniel 0
- **THEN** Isaías is elected, Jeremías and Ezequiel are tied at the cut, and Daniel is out

#### Scenario: Added for choice

- **WHEN** a 2-seat committee vote has a base of 38 and Isaías gets 22, Jeremías 12, Ezequiel 4 and Daniel 0
- **THEN** Isaías is elected, Jeremías has no majority, Ezequiel is added for choice, and Daniel is out

#### Scenario: Reasons are exclusive

- **WHEN** any election result is reported
- **THEN** no option is both elected and continuing, the elected never exceed the seats, and every option has one reason

### Requirement: Screens explain each result in one paragraph

Each screen SHALL turn the reported result into one short paragraph in plain Spanish built from that result's own numbers. A screen SHALL NOT compute the votes needed, the reasons or the outcome. The paragraph SHALL contain, in order:

1. The rule sentence: «{rule} de {base} habilitados = {votes needed} votos.» With the secretary, the base reads «{base} habilitados ({delegates} + secretaría regional)». One vote reads «1 voto».
2. For an A favor / En contra decision: «A favor: {votes}. Aprobada.» or «A favor: {votes}. No aprobada.»
3. For an election or an Opciones decision, one sentence per reason that has options, in this order and listing each option with its votes in brackets:
   - elected in an election: «Electo/a: …»
   - elected in an Opciones decision: «Aprobada: …»
   - no majority: «Sin mayoría: …»
   - tied at the cut: «Empate en el último puesto: …»
   - added for choice: «Se agrega para que haya opción: …»
4. When options continue: «Pasan a la siguiente votación.»

Out options are not listed, because the result rows already show them. The paragraph SHALL show only counts the result already shows and never how a person voted.

The screen uses «habilitados» for the base, as the rest of the screens do, where #58's example says «elegibles».

Source: #58, maintainer decision of 8 Nov 2026, and its example «3/4 de 38 elegibles = 29 votos. A favor: 29. Aprobada.»

#### Scenario: 3/4 decision approved

- **WHEN** an A favor / En contra decision under 3/4 has a base of 38 and «A favor» gets 29
- **THEN** the paragraph reads «3/4 de 38 habilitados = 29 votos. A favor: 29. Aprobada.»

#### Scenario: Office without a majority

- **WHEN** an office election has a base of 38 and Isaías gets 18, Jeremías 12 and Ezequiel 8
- **THEN** the paragraph reads «Mayoría simple de 38 habilitados = 20 votos. Sin mayoría: Isaías (18). Se agrega para que haya opción: Jeremías (12). Pasan a la siguiente votación.»

#### Scenario: Committee with every reason

- **WHEN** a 3-seat committee vote has a base of 38 and Isaías gets 22, Jeremías 12, Ezequiel 8, Daniel 8 and Oseas 0
- **THEN** the paragraph reads «Mayoría simple de 38 habilitados = 20 votos. Electo/a: Isaías (22). Sin mayoría: Jeremías (12). Empate en el último puesto: Ezequiel (8) y Daniel (8). Pasan a la siguiente votación.»

#### Scenario: Secretary in the base

- **WHEN** an office election has 28 delegates plus the regional secretary in its base and Isaías gets 16
- **THEN** the paragraph begins «Mayoría simple de 29 habilitados (28 + secretaría regional) = 15 votos.»

#### Scenario: Elected in a committee

- **WHEN** a 2-seat committee vote has a base of 38 and Isaías gets 22 and Jeremías 21
- **THEN** the paragraph reads «Mayoría simple de 38 habilitados = 20 votos. Electo/a: Isaías (22) y Jeremías (21).»

### Requirement: Where each screen shows the explanation

Every result in the mesa SHALL have an information button that opens and closes the paragraph. Every result on the public screen SHALL show the paragraph as a fixed line, because nobody can tap a projector. This applies to preliminary and final results alike. The phone SHALL show no rule, paragraph or information button.

Source: #58. The user decided on 8 Nov 2026 that the phone shows only the voting controls and the projector communicates everything else. #58's phone information button is declined.

#### Scenario: Mesa result

- **WHEN** a result is in the mesa
- **THEN** the paragraph is hidden until the operator taps the information button

#### Scenario: Public screen

- **WHEN** a result is on the public screen
- **THEN** the paragraph shows as a fixed line with no button

#### Scenario: Phone

- **WHEN** a vote is open or its result is out
- **THEN** the phone shows no rule, no paragraph and no information button
