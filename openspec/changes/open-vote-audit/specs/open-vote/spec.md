## ADDED Requirements

### Requirement: Nothing replaces the open vote on the projector

While a vote is open, the tool SHALL refuse to start «Presentar oficiales», and the mesa SHALL NOT offer it. Once the vote closes or is annulled, the mesa SHALL be able to start it.

Source: issue #78, and the owner's decision of 8 November 2026 that nothing can interrupt an open vote.

#### Scenario: Present officials during an open vote

- **WHEN** a vote is open and the mesa asks to start «Presentar oficiales»
- **THEN** the request is refused, the projector keeps showing the vote, and the mesa shows no «Presentar oficiales» control

#### Scenario: Present officials after the vote

- **WHEN** the open vote has closed
- **THEN** the mesa can start «Presentar oficiales»

### Requirement: No official roster change during an open vote

While a vote is open, the tool SHALL refuse to add an election to the officials list. Once the vote closes or is annulled, it SHALL accept it.

Source: issue #78.

#### Scenario: Register an election during an open vote

- **WHEN** a vote is open and the mesa adds a complete election to the officials list
- **THEN** the request is refused and the list does not change

### Requirement: No secrecy cleanup retry during an open vote

While a vote is open, the tool SHALL refuse to retry the vote-secrecy cleanup, and the mesa SHALL NOT offer «Reintentar limpieza». It SHALL keep showing that a cleanup is pending. Closing the open vote SHALL run the pending cleanup.

Source: issue #78. A retry locks the votes table and would stall ballots.

#### Scenario: Retry during an open vote

- **WHEN** an earlier vote's cleanup is pending and another vote is open
- **THEN** a retry is refused, and the mesa shows the pending cleanup without a retry button

#### Scenario: Closing runs the cleanup

- **WHEN** the open vote closes
- **THEN** the pending cleanup runs

### Requirement: No preparing the next vote during an open vote

While a vote is open, the tool SHALL refuse to create a ballot, add a department, repeat an annulled vote, add or remove a draft's candidates, and add or remove the regional secretary, and the mesa SHALL NOT offer those controls. Once the vote closes or is annulled, all of them SHALL work.

Source: issue #78, and the owner's decision of 8 November 2026 that the mesa prepares the next vote only after the open one ends.

#### Scenario: Prepare during an open vote

- **WHEN** a vote is open and the mesa tries any preparation action
- **THEN** the request is refused with «Prepara la siguiente votación cuando cierre la votación abierta», and the mesa shows no preparation control

#### Scenario: Prepare after the vote

- **WHEN** the open vote has closed or been annulled
- **THEN** every preparation action works
