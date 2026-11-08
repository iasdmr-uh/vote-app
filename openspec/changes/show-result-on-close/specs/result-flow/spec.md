## Purpose

Defines when a vote's result appears, on which screens, what it says and how long it stays, so the whole room sees each result at the same moment and checks it before the election moves on.

## ADDED Requirements

### Requirement: Closing a vote shows its result everywhere at once

When a vote closes, the system SHALL show its result on the phones, the public screen and the operator console at once, with no further operator action. The system SHALL offer no separate action to publish a result.

Source: issue #76, cleared for build on 2026-11-08.

#### Scenario: Operator closes a vote

- **WHEN** the operator closes a vote and its votes are separated from the voters
- **THEN** the phones, the public screen and the operator console show its result
- **AND** the operator takes no other action for that to happen

#### Scenario: No publish action

- **WHEN** a vote has closed
- **THEN** the operator console offers no action to publish its result
- **AND** the system refuses any request to publish a result

#### Scenario: Reconnecting screen recovers the result

- **WHEN** a phone or screen reconnects after a vote's result was shown
- **THEN** it shows the same result after it recovers its state

### Requirement: The operator never sees counts first

The operator console SHALL NOT receive or show a vote's counts before the public screen can show them. While a vote is open or its result is being prepared, the operator console SHALL receive no counts per candidate or option.

Source: issue #76, cleared for build on 2026-11-08.

#### Scenario: Result still being prepared

- **WHEN** a vote has closed and its votes are not yet separated from the voters
- **THEN** the operator console's state contains no counts for that vote

#### Scenario: Result shown

- **WHEN** a vote's result is shown on the public screen
- **THEN** the operator console receives the same counts and no others

### Requirement: No result before the votes are separated

No screen SHALL show a vote's result until its votes are separated from the voters. Until then every screen SHALL say the result is being prepared, and the operator console SHALL offer a retry. A successful retry SHALL show the result on every screen at once.

Source: issue #76, cleared for build on 2026-11-08.

#### Scenario: Separation fails

- **WHEN** a vote closes and separating its votes from the voters fails
- **THEN** the phones, the public screen and the operator console say the result is being prepared
- **AND** the operator console offers a retry

#### Scenario: Retry succeeds

- **WHEN** the operator retries and the separation completes
- **THEN** the phones, the public screen and the operator console show the result at once

### Requirement: The result stays until the next vote opens

A vote's result SHALL stay on the phones, the public screen and the operator console until the operator opens the next vote. Preparing a vote or adding a result to the official roster SHALL NOT replace it.

Source: issue #76, cleared for build on 2026-11-08.

#### Scenario: Next vote prepared but not open

- **WHEN** a result is shown and the operator prepares another vote without opening it
- **THEN** every screen still shows the result

#### Scenario: Next vote opens

- **WHEN** the operator opens the next vote
- **THEN** every screen replaces the result with that vote

### Requirement: A vote that does not settle shows who goes on

When a vote does not settle its election or decision, its result SHALL show which candidates or options go to the next vote. The system SHALL NOT open that vote by itself. The operator opens it on the Presiding Officer's word.

Source: issue #76, cleared for build on 2026-11-08. Who goes to the next vote follows the result rules confirmed on 2026-11-02 (`docs/scope.md` section 8, rules 11, 12 and 14).

#### Scenario: Office without a majority

- **WHEN** a vote for an office closes and no candidate reaches a majority
- **THEN** its result shows the candidates that go to the next vote
- **AND** the next vote stays unopened until the operator opens it

### Requirement: A vote that settles says final and lists everyone elected

When a vote settles its election, its result SHALL say it is final and SHALL list everyone elected in that election, including seats filled in earlier votes of the same election.

Source: issue #76, cleared for build on 2026-11-08.

#### Scenario: Committee settled in a runoff

- **WHEN** a committee of three elects Isaías in its first vote and Jeremías and Ezequiel in the runoff
- **THEN** the runoff's result says final
- **AND** it lists Isaías, Jeremías and Ezequiel as elected

#### Scenario: Office settled in the first vote

- **WHEN** a vote for an office closes and one candidate is elected
- **THEN** its result says final and lists that candidate

### Requirement: A result is preliminary until its election is complete

A result SHALL be final only when its election is complete, meaning every seat of the office or committee is filled. Until then it is preliminary, and no view SHALL show «RESULTADO OFICIAL» or final wording. Only a final result SHALL go to «Agregar a oficiales». While seats are still open, the operator console, the phones and the public screen SHALL list everyone elected so far, each marked «Electo/a», with how many seats are filled out of the total. Someone elected SHALL NOT appear on a later ballot of the same election.

Source: decision of the user on 2026-11-08 for issue #76.

#### Scenario: Committee of five with three elected

- **WHEN** a committee of five elects three in its first vote and sends others to a runoff
- **THEN** the phones, the public screen and the operator console list the three, each marked «Electo/a», with «Electos hasta ahora · 3 de 5»
- **AND** no view shows «RESULTADO OFICIAL» or final wording

#### Scenario: Committee of five complete

- **WHEN** the runoff fills the last two seats of the committee of five
- **THEN** the result is final and lists all five

#### Scenario: The elected leave the next ballot

- **WHEN** a committee's runoff opens
- **THEN** its ballot holds no one elected earlier in the same election

### Requirement: A decision ends as approved or not approved

When a vote settles a decision, its result SHALL say it is final and whether the decision was approved or not approved.

Source: issue #76, cleared for build on 2026-11-08. Approval follows the rules confirmed on 2026-11-02 (`docs/scope.md` section 8, rule 14).

#### Scenario: A favor reaches the threshold

- **WHEN** an A favor / En contra decision closes and A favor reaches its threshold
- **THEN** its result says final and approved

#### Scenario: Even split

- **WHEN** an A favor / En contra decision closes with an even split
- **THEN** its result says final and not approved

### Requirement: Another election waits for the roster or an annulment

The system SHALL refuse to open a vote of an election or decision while another election or decision has a closed vote that is not annulled and whose final result is not on the official roster. Opening the next vote of the same election SHALL stay allowed.

Source: issue #76, cleared for build on 2026-11-08.

#### Scenario: Final result not yet on the roster

- **WHEN** the Presidente election has a final result that is not on the official roster
- **AND** the operator tries to open the first vote of the Secretario election
- **THEN** the system refuses
- **AND** the Secretario vote stays unopened

#### Scenario: Runoff pending

- **WHEN** the Presidente election has a closed vote that did not settle it
- **AND** the operator tries to open a vote of another election
- **THEN** the system refuses

#### Scenario: Runoff of the same election

- **WHEN** the Presidente election has a closed vote that did not settle it
- **AND** the operator opens the Presidente runoff
- **THEN** the system opens it

#### Scenario: Last vote annulled

- **WHEN** the latest vote of the Presidente election is annulled
- **AND** the operator opens a vote of another election
- **THEN** the system opens it

#### Scenario: Final result on the roster

- **WHEN** the Presidente final result is on the official roster
- **AND** the operator opens a vote of another election
- **THEN** the system opens it

### Requirement: Annulment window

The operator SHALL be able to annul a vote, with a reason, until the next vote of its election opens or its election's result goes on the official roster. After either event the system SHALL refuse to annul it. When a vote is annulled, the phones, the public screen and the operator console SHALL show it as annulled.

Source: issue #76, cleared for build on 2026-11-08.

#### Scenario: Annul a shown result

- **WHEN** a vote's result is shown and nothing of its election is on the official roster
- **AND** the operator annuls it with a reason
- **THEN** every screen shows the vote as annulled

#### Scenario: Annul after the runoff opened

- **WHEN** a vote's runoff has opened
- **AND** the operator tries to annul the earlier vote
- **THEN** the system refuses

#### Scenario: Annul after the roster

- **WHEN** a final result is on the official roster
- **AND** the operator tries to annul the vote that settled it
- **THEN** the system refuses

#### Scenario: Annulment needs a reason

- **WHEN** the operator tries to annul a vote with an empty reason
- **THEN** the system refuses
