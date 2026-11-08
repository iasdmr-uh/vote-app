## ADDED Requirements

### Requirement: A decision can require 2/3 of the base

When the mesa prepares a decision, it SHALL be able to choose «2/3» as the approval rule, next to «Mayoría simple» and «3/4». A 2/3 decision SHALL need at least 2/3 of the base, rounded up. The base SHALL be the same base the other rules use, everyone in the room when voting opens, abstentions included.

Source: Reglamento 01-02 03, «sólo pueden ser modificados con las 2/3 partes de los votos de la Asamblea». #87.

#### Scenario: 28 in the room

- **WHEN** a 2/3 decision opens with 28 people in the room
- **THEN** it needs 19 votes

#### Scenario: Exact two thirds

- **WHEN** a 2/3 decision opens with 30 people in the room
- **THEN** it needs 20 votes

#### Scenario: A favor reaches 2/3

- **WHEN** an A favor / En contra decision under 2/3 has a base of 28 and «A favor» gets 19 votes
- **THEN** the decision is approved

#### Scenario: A favor falls one short

- **WHEN** an A favor / En contra decision under 2/3 has a base of 28 and «A favor» gets 18 votes
- **THEN** the decision is not approved

#### Scenario: Abstentions count in the base

- **WHEN** a 2/3 decision has a base of 28, «A favor» gets 18 votes, «En contra» gets 0 and 10 people do not vote
- **THEN** the decision is not approved

#### Scenario: Opciones under 2/3

- **WHEN** an Opciones decision under 2/3 has a base of 28 and no option gets 19 votes
- **THEN** the vote repeats between the most voted, as it does under the other rules

#### Scenario: Nobody in the room

- **WHEN** a 2/3 decision has a base of 0
- **THEN** it needs 1 vote

### Requirement: Only known rules are accepted

The API and the database SHALL accept only «Mayoría simple», «3/4» and «2/3» as approval rules, and SHALL reject any other value. An election SHALL reject any rule other than simple majority.

Source: #54, every ballot uses one rule from a fixed list.

#### Scenario: Unknown rule

- **WHEN** a round is stored with an approval rule outside the three
- **THEN** the database rejects it

#### Scenario: Election with 2/3

- **WHEN** the mesa prepares an election with the 2/3 rule
- **THEN** the API rejects it and elections keep their own rules

### Requirement: The rule and the votes needed are shown

Before they vote, delegates SHALL see on their phone the rule of every decision and the votes it needs, whether simple majority, 2/3 or 3/4. An election SHALL show no approval rule. The results, the public screen and the acta SHALL name «2/3» and the votes needed.

Source: #87. #54 asks for the rule before voting. The user decided on 8 Nov 2026 that every decision shows it, not only 2/3.

#### Scenario: Phone before voting

- **WHEN** a 2/3 decision is open with 28 in the room
- **THEN** the phone shows «Se aprueba con 2/3 · 19 votos» above the options

#### Scenario: Simple majority on the phone

- **WHEN** a simple-majority decision is open with 28 in the room
- **THEN** the phone shows «Se aprueba con mayoría simple · 15 votos» above the options

#### Scenario: Election on the phone

- **WHEN** an election is open
- **THEN** the phone shows no approval rule

#### Scenario: Results and acta

- **WHEN** a 2/3 decision with a base of 28 is closed
- **THEN** the results, the public screen and the acta show «Se aprueba con 2/3 · 19 votos»
