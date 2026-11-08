## Purpose

Defines the official roster of final results, how the operator adds a final result to it on the Presiding Officer's word, why an entry cannot be undone in the tool, and what «Presentar oficiales» shows from it.

## ADDED Requirements

### Requirement: The operator adds a final result to the official roster

The operator SHALL be able to add a final result to the official roster in one action. For an election the action SHALL add everyone elected in that election together, including seats filled in earlier votes. For a decision it SHALL add whether the decision was approved or not approved. The system SHALL refuse the action for a vote that did not settle its election, for a result still being prepared, and for an annulled vote.

Source: issue #76, cleared for build on 2026-11-08.

#### Scenario: Committee added together

- **WHEN** a committee's final result lists Isaías, Jeremías and Ezequiel, elected across two votes
- **AND** the operator adds it to the official roster
- **THEN** the roster holds all three for that committee in one entry

#### Scenario: Decision added

- **WHEN** a decision's final result is not approved
- **AND** the operator adds it to the official roster
- **THEN** the roster holds that decision as not approved

#### Scenario: Vote that did not settle

- **WHEN** a vote's result sends candidates to a runoff
- **AND** the operator tries to add it to the official roster
- **THEN** the system refuses

#### Scenario: Result still being prepared

- **WHEN** a vote has closed and its result is still being prepared
- **AND** the operator tries to add it to the official roster
- **THEN** the system refuses

#### Scenario: Adding twice

- **WHEN** a final result is already on the official roster
- **AND** the operator adds it again
- **THEN** the roster is unchanged

### Requirement: A roster entry cannot be undone in the tool

The system SHALL offer no action to remove or change an entry on the official roster. The database SHALL also refuse to change an entry once it is on the roster. A mistake goes to the Assembly.

Source: issue #76, cleared for build on 2026-11-08.

#### Scenario: No undo action

- **WHEN** a final result is on the official roster
- **THEN** the operator console offers no action to remove or change it

#### Scenario: Direct change refused

- **WHEN** a statement tries to clear or change the time a final result went on the roster
- **THEN** the database refuses it

### Requirement: Adding to the roster is logged

Adding a final result to the official roster SHALL add one entry to the operator log, with its time and kind «Resultados». The entry SHALL name the election or decision and SHALL NOT record how anyone voted or who voted.

Source: issue #79, cleared for build on 2026-11-08, which names the official roster among the logged actions.

#### Scenario: Roster entry logged

- **WHEN** the operator adds the Presidente final result to the official roster
- **THEN** the operator log gains one entry of kind «Resultados» that names the Presidente election

### Requirement: «Presentar oficiales» shows only the roster

«Presentar oficiales» SHALL show as elected only people whose election's final result is on the official roster. A shown result that is not on the roster SHALL NOT appear in it.

Source: issue #76, cleared for build on 2026-11-08.

#### Scenario: Final result not yet added

- **WHEN** the Presidente final result is shown but not on the official roster
- **THEN** «Presentar oficiales» shows the Presidente position without a name

#### Scenario: Final result added

- **WHEN** the operator adds the Presidente final result to the official roster
- **THEN** «Presentar oficiales» shows the elected name for Presidente
