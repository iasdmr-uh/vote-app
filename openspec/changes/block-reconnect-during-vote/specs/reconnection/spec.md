## ADDED Requirements

### Requirement: No joining during an open vote

While a vote is open, the tool SHALL refuse to join anyone with the assembly code, and the phone SHALL say that a vote is in progress and to wait. Once the vote closes or is annulled, joining SHALL follow the usual check-in rule.

Source: issue #78, and the owner's decision of 8 November 2026 that nothing can interrupt an open vote.

#### Scenario: Join during an open vote

- **WHEN** a vote is open and someone enters the assembly code with a name
- **THEN** no session is created and the phone says a vote is in progress and to wait

#### Scenario: Join after the vote

- **WHEN** the open vote was closed or annulled and the mesa reopened check-in
- **THEN** joining with the assembly code works

### Requirement: No reconnection codes during an open vote

While a vote is open, the tool SHALL refuse to issue a reconnection code and SHALL refuse to redeem any one-use code, including a reconnection code issued before the vote opened and the regional secretary's entry QR. A refused redemption SHALL leave the code unused.

Source: issue #78, and the owner's decision of 8 November 2026 that nothing can interrupt an open vote.

#### Scenario: Issue during an open vote

- **WHEN** a vote is open and the operator asks for a delegate's reconnection code
- **THEN** the request is refused and no code is issued or recorded

#### Scenario: Redeem an earlier code during an open vote

- **WHEN** a code was issued before a vote opened and someone redeems it while the vote is open
- **THEN** the redemption is refused, the delegate's existing session keeps working, and the code stays unused

#### Scenario: After the vote closes

- **WHEN** a code was issued before a vote opened and the vote has closed
- **THEN** the code can be redeemed once, until it expires

#### Scenario: Secretary entry QR during an open vote

- **WHEN** the operator added the regional secretary to a draft vote, the vote opened, and the secretary scans the entry QR for the first time
- **THEN** the redemption is refused, and the QR works once the vote closes

#### Scenario: After the vote is annulled

- **WHEN** the operator annuls the open vote with a recorded reason
- **THEN** the operator can issue a reconnection code right away and the delegate can redeem it

### Requirement: A phone keeps its own session

A phone that loses its network and reconnects with its own session token SHALL keep its session during an open vote.

Source: issue #78.

#### Scenario: Network loss during a vote

- **WHEN** a vote is open and a delegate's phone reconnects with its existing session token
- **THEN** the phone is accepted and can still vote if it has not voted

### Requirement: No reconnection code for the regional secretary

The tool SHALL refuse to issue a reconnection code for the regional secretary. If the secretary's device is lost, the operator takes them out and the secretary joins again by QR.

Source: issue #78, with #85 for how the secretary joins.

#### Scenario: Secretary reconnection

- **WHEN** the operator asks for a reconnection code for the regional secretary
- **THEN** the request is refused

### Requirement: No assembly code change during an open vote

While a vote is open, the tool SHALL refuse to change the assembly code, and SHALL NOT revoke any public session. Once the vote closes or is annulled, the mesa SHALL be able to change it again.

Source: issue #78, and the owner's decision of 8 November 2026 that nothing can interrupt an open vote.

#### Scenario: Change the code during an open vote

- **WHEN** a vote is open and the mesa asks for a new assembly code
- **THEN** the code stays the same, no public session is revoked, nothing is recorded, and the console does not offer «Nuevo código»

#### Scenario: Change the code after the vote

- **WHEN** the open vote was closed or annulled
- **THEN** the mesa can change the assembly code

### Requirement: Console hides reconnection during a vote

While a vote is open, the operator console SHALL NOT offer «Reconectar dispositivo» or any other participant menu action.

Source: issue #78.

#### Scenario: Open vote

- **WHEN** a vote is open
- **THEN** no participant row shows the actions menu

#### Scenario: Regional secretary row

- **WHEN** the regional secretary is in the room
- **THEN** the secretary's row offers no «Reconectar dispositivo»
