## Purpose

Lets anyone the Assembly asks review afterwards what the operator did and when, from a downloaded file, without the log revealing how anyone voted or who voted.

## ADDED Requirements

### Requirement: Operator actions are logged

The system SHALL add one log entry, with its time, for every operator action that changes something. This includes creating the assembly, taking a person out of the room, disabling or enabling a delegate, re-admitting a person, issuing a «Reconectar dispositivo» code, opening and closing the room, changing the room code, adding a position, preparing, opening, closing, repeating and annulling a vote, adding and removing a candidate, adding and removing the regional secretary, publishing results, changing the public screen, completing the assembly and downloading the log. An annulment entry SHALL include its reason.

Source: issue #79, cleared for build on 2026-11-08.

#### Scenario: Taking a person out is logged

- **WHEN** the operator takes a person out of the room
- **THEN** the log gains one entry with the time of the action

#### Scenario: Annulment keeps its reason

- **WHEN** the operator annuls a vote with the reason «Error en la papeleta»
- **THEN** the log entry for the annulment includes «Error en la papeleta»

#### Scenario: A refused action is not logged

- **WHEN** the operator tries an action and the system refuses it
- **THEN** the log gains no entry

### Requirement: Viewing and delegate actions are not logged

The system SHALL NOT add a log entry when someone only views a screen, or for a delegate's own actions, such as joining, voting or redeeming a «Reconectar dispositivo» code.

Source: issue #79, cleared for build on 2026-11-08.

#### Scenario: A delegate joins

- **WHEN** a delegate joins the room from their phone
- **THEN** the log gains no entry

#### Scenario: A delegate reconnects with a code

- **WHEN** a delegate redeems a «Reconectar dispositivo» code
- **THEN** the log gains no entry

### Requirement: Closing by itself is logged as the system

A vote that closes by itself SHALL be logged with the system as the actor and the reason it closed. The entry is written by the change that builds closing by itself.

Source: issues #79 and #83, cleared for build on 2026-11-08.

#### Scenario: Everyone has voted

- **WHEN** a vote closes by itself because everyone had voted
- **THEN** its log entry names the system as the actor and says everyone had voted

### Requirement: Each entry has one kind

Each entry SHALL have exactly one kind out of «Entrada», «Votación», «Resultados» and «Datos».

- «Entrada» covers who is in the room and who may vote: opening and closing the room, changing the room code, taking out, re-admitting, disabling, enabling, correcting or removing a person, «Reconectar dispositivo» codes, and the regional secretary.
- «Votación» covers votes: preparing, opening, closing, repeating and annulling a vote, candidates and positions.
- «Resultados» covers results: publishing, the official roster and the public screen.
- «Datos» covers the assembly's data: creating and completing the assembly and downloading the log.

Source for the four kinds: issue #79, cleared for build on 2026-11-08. UNCONFIRMED: the assignment of each action to a kind.

#### Scenario: Disabling a delegate

- **WHEN** the operator disables a delegate
- **THEN** the entry's kind is «Entrada»

#### Scenario: Annulling a vote

- **WHEN** the operator annuls a vote
- **THEN** the entry's kind is «Votación»

#### Scenario: Downloading the log

- **WHEN** the operator downloads the log
- **THEN** the entry's kind is «Datos»

### Requirement: An entry about a person names them

An entry about a person SHALL name them as the mesa list showed them when the action happened, such as «Delegado 12 retirado de la sala». A later name correction SHALL NOT change earlier entries.

Source: issue #79, cleared for build on 2026-11-08.

#### Scenario: Name in the entry

- **WHEN** the operator takes «Delegado 12» out of the room
- **THEN** the entry reads «Delegado 12 retirado de la sala»

#### Scenario: Name corrected later

- **WHEN** the operator disables «Delegado 12» and later corrects the name to «Delegado 21»
- **THEN** the disabling entry still names «Delegado 12»

### Requirement: The log keeps votes secret

The log SHALL NOT record how anyone voted or who voted, in any entry or file.

Source: issue #79, cleared for build on 2026-11-08.

#### Scenario: A vote closes

- **WHEN** a vote in which delegates voted is closed and the log is downloaded
- **THEN** no entry names a person who voted or a choice anyone made

### Requirement: The log is read from a downloaded file

The operator SHALL get the log only as a downloaded file. The tool SHALL NOT have a screen that shows the log. The file SHALL hold every entry recorded so far for the assembly, oldest first, in a defined order when two entries share a time. A person without technical skills SHALL be able to open the file in a spreadsheet or a text viewer and read each entry's time, kind and action.

Source: issue #79, cleared for build on 2026-11-08. UNCONFIRMED: times are shown in Honduras time.

#### Scenario: Opening the file

- **WHEN** the operator downloads the log and opens it in a spreadsheet
- **THEN** each row shows a time, a kind and an action in Spanish, with accented letters intact

#### Scenario: Same time

- **WHEN** two entries were written at the same instant
- **THEN** the file lists them in the order they were recorded, every time it is downloaded

#### Scenario: A name that looks like a formula

- **WHEN** a person's name starts with «=»
- **THEN** a spreadsheet shows the name as text and does not evaluate it

### Requirement: Downloading the log is logged

Each download SHALL add its own entry before the file is produced, so the last entry in the file is that download. A download for «Borrar datos» SHALL say so in its entry.

Source: issue #79, cleared for build on 2026-11-08.

#### Scenario: Plain download

- **WHEN** the operator downloads the log
- **THEN** the last entry in the file is that download

#### Scenario: Download for «Borrar datos»

- **WHEN** the operator downloads the log for «Borrar datos»
- **THEN** the last entry in the file is that download and says it was for «Borrar datos»

### Requirement: «Borrar datos» needs the latest log download

The system SHALL refuse «Borrar datos» unless the last entry of the log is a download for «Borrar datos» and that download's file held every entry recorded so far. Any entry recorded after that download SHALL require downloading again.

Source: issue #79, cleared for build on 2026-11-08. Data is erased after the assembly by Secretaría's decision of October 2026.

#### Scenario: No download yet

- **WHEN** the operator asks to erase a completed assembly and the log was never downloaded for «Borrar datos»
- **THEN** the system refuses and asks to download the log first

#### Scenario: Downloaded, then erased

- **WHEN** the operator downloads the log for «Borrar datos» and then asks to erase the completed assembly
- **THEN** the system erases it

#### Scenario: An action after the download

- **WHEN** the operator downloads the log for «Borrar datos», then changes the public screen, then asks to erase
- **THEN** the system refuses until the log is downloaded again

#### Scenario: A plain download does not count

- **WHEN** the operator's last download was a plain download and the operator asks to erase
- **THEN** the system refuses
