## Purpose

Lets each delegate see that their phone is connected while a vote is open, and lets the room see how many phones in the base of the vote are connected, without naming anyone.

## ADDED Requirements

### Requirement: Phone shows its own connection during a vote

While a vote is open, a delegate's phone SHALL show «Conectado» when the server can reach it. When the server cannot reach it, the phone SHALL show the existing connection notice instead. The phone SHALL show exactly one of the two at any time during a vote.

Source: #84, cleared for handoff on 2026-11-08.

#### Scenario: Connected phone during a vote

- **WHEN** a vote is open and the phone's connection to the server is up
- **THEN** the phone shows «Conectado» and does not show the connection notice

#### Scenario: Phone loses its connection during a vote

- **WHEN** a vote is open and the phone's connection to the server stays down past the grace period
- **THEN** the phone stops showing «Conectado» and shows the connection notice

#### Scenario: No vote is open

- **WHEN** no vote is open
- **THEN** the phone does not show «Conectado»

### Requirement: Connection loss shows within seconds

A phone SHALL stop showing «Conectado» within 10 seconds after it loses its connection to the server, including a silent loss where the network stops answering. The server SHALL stop counting that phone within the same bound.

Source: #84 says "within a few seconds". The 10-second bound is UNCONFIRMED.

#### Scenario: Network stops answering

- **WHEN** a vote is open and a phone's network stops passing traffic without closing the connection
- **THEN** within 10 seconds the phone shows the connection notice and the room's count no longer includes that person, unless another of their devices is connected

### Requirement: Brief drops do not flicker

A connection drop that recovers within the grace period SHALL NOT change what the phone shows, and SHALL NOT change the room's count. The grace period is 3 seconds.

Source: #84. The 3-second value is UNCONFIRMED.

#### Scenario: Drop recovers within the grace period

- **WHEN** a phone's connection drops and comes back within 3 seconds
- **THEN** the phone keeps showing «Conectado» throughout and "X de Y conectados" does not change

#### Scenario: Drop outlasts the grace period

- **WHEN** a phone's connection drops and stays down longer than 3 seconds
- **THEN** the phone shows the connection notice and X goes down by one if the person has no other connected device

### Requirement: Room sees how many phones are connected

While a vote is open, the public screen and the operator console SHALL show "X de Y conectados". Y SHALL be the base of the vote, the same Y as in "X de Y han votado". X SHALL count the people in that base who have at least one connected device. X SHALL never exceed Y.

Source: #84 and #55, cleared for handoff on 2026-11-08.

#### Scenario: Everyone in the base is connected

- **WHEN** a vote is open with a base of 50 and all 50 people have a connected phone
- **THEN** the public screen and the operator console show "50 de 50 conectados"

#### Scenario: Some phones are down

- **WHEN** a vote is open with a base of 50 and 3 people have no connected device
- **THEN** both screens show "47 de 50 conectados"

#### Scenario: Connected device of someone outside the base

- **WHEN** a vote is open and a person outside its base, such as the regional secretary in a vote they were not added to, has a connected phone
- **THEN** that phone does not count in X

#### Scenario: Disabled delegate

- **WHEN** a vote is open and a disabled delegate in its base has a connected phone
- **THEN** that person counts in X, because disabled delegates stay in the base

#### Scenario: Empty base

- **WHEN** a vote is open and its base is 0
- **THEN** both screens show "0 de 0 conectados"

### Requirement: One person counts once

A person with more than one device or browser tab SHALL count once in X, as connected if any of their devices is connected.

Source: #84.

#### Scenario: Two devices, one connected

- **WHEN** a person in the base has two devices with the same session and only one is connected
- **THEN** the person counts once in X

#### Scenario: Two devices, both connected

- **WHEN** a person in the base has two connected devices
- **THEN** the person counts once in X

#### Scenario: Last device drops

- **WHEN** a person's only connected device drops past the grace period while their other device is already down
- **THEN** X goes down by one

### Requirement: Count exists only while a vote is open

The connected count SHALL appear only while a vote is open. It SHALL disappear from the public screen and the operator console when the vote closes or is annulled.

Source: #84.

#### Scenario: Vote closes

- **WHEN** an open vote closes
- **THEN** neither screen shows "X de Y conectados"

#### Scenario: Vote is annulled

- **WHEN** an open vote is annulled
- **THEN** neither screen shows "X de Y conectados"

#### Scenario: Recovery after reconnecting

- **WHEN** the public screen or the operator console reconnects while a vote is open
- **THEN** it shows the current count from the server without waiting for the next change

### Requirement: Nobody learns who is offline

The operator console, the public screen and every broadcast SHALL carry only the aggregate count. No screen, broadcast or response available to the operator or the public SHALL name or identify who is connected or offline. The server SHALL NOT log which participant connected or disconnected.

Source: #84 ("The operator console shows no list of who is offline") and #55.

#### Scenario: Operator looks for offline delegates

- **WHEN** a vote is open and some phones are down
- **THEN** the operator console shows only "X de Y conectados" and no names, rows or markers per person

#### Scenario: Count broadcast

- **WHEN** the count changes
- **THEN** the message to the public screen and the operator console contains only the vote, X and Y

### Requirement: Accepted limits of the count

The count SHALL be documented as a connection signal only. A connected phone does not prove that its owner is in the room or able to vote, and a phone whose browser the operating system suspends, such as on a locked screen, counts as not connected.

Source: config rule to state accepted limits openly.

#### Scenario: Locked phone

- **WHEN** a delegate locks their phone and the operating system suspends the browser's connection
- **THEN** the phone stops counting in X until the browser is active and connected again
