## ADDED Requirements

### Requirement: No who-voted data for the operator

The tool SHALL give the operator no way to see which people have voted in any vote, while it is open or after it closes. The operator SHALL see only the number of people who voted and the base of the vote.

Source: issue #55, owner decision of 8 Nov 2026. This replaces the operator's list of who voted in `docs/scope.md` sections 9 and 18.

#### Scenario: Open vote

- **WHEN** a vote is open and some delegates have voted
- **THEN** the moderator assembly state includes the number who voted and the base
- **AND** no participant entry and no regional secretary entry says whether that person voted

#### Scenario: Closed vote

- **WHEN** a vote has closed
- **THEN** the moderator assembly state still says nothing about which people voted

#### Scenario: Operator console

- **WHEN** the operator looks at the participant list during or after a vote
- **THEN** no person, including the regional secretary, is marked as having voted or not

### Requirement: No counts per option while a vote is open

While a vote is open, the moderator assembly state and the public screen state SHALL NOT include votes per candidate or option.

Source: issue #55, owner decision of 8 Nov 2026.

#### Scenario: Open vote with ballots cast

- **WHEN** a vote is open and ballots have been cast
- **THEN** the moderator assembly state carries no counts per option for that vote

### Requirement: No disabling, re-enabling or take-out during an open vote

While a vote is open, the tool SHALL refuse to disable a delegate, SHALL refuse to re-enable a disabled delegate, and SHALL refuse to take anyone out of the room, including the regional secretary. The open vote's base and its voters stay as they were when it opened.

Source: issue #55 and owner decision of 8 Nov 2026 for disabling and take-out. Owner decision of 8 Nov 2026 for re-enabling, not yet recorded in an issue. This replaces that part of `docs/scope.md` section 8 rule 15.

#### Scenario: Disable during an open vote

- **WHEN** a vote is open and the operator disables a delegate
- **THEN** the request is refused and the delegate's voting stays enabled

#### Scenario: Re-enable during an open vote

- **WHEN** a vote is open and the operator re-enables a disabled delegate
- **THEN** the request is refused and the delegate cannot vote in the open vote

#### Scenario: Take-out during an open vote

- **WHEN** a vote is open and the operator takes a person out of the room
- **THEN** the request is refused and the person stays in the room

#### Scenario: Between votes

- **WHEN** no vote is open
- **THEN** disabling, re-enabling and taking a person out work as before

### Requirement: One vote per person per vote

A person SHALL vote at most once in each vote and SHALL NOT change a confirmed vote. Repeating an annulled vote SHALL be a new vote in which each person votes again.

Source: issue #55. `docs/scope.md` section 8 already states no edit of a cast vote.

#### Scenario: Second ballot in the same vote

- **WHEN** a delegate who already voted submits another ballot in the same vote
- **THEN** the second ballot is refused and the count stays the same

#### Scenario: Repeat after annulment

- **WHEN** a vote is annulled and repeated
- **THEN** a delegate who voted in the annulled vote can vote in the repeat
