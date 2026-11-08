## Context

`audit_events` already gets a row for most moderator actions, with an action code, a time and JSON metadata. Metadata about a person holds only a participant id, rows written in one transaction share the same `occurred_at`, and nothing exports the rows. «Borrar datos» (`DELETE /moderator/assemblies/:id`) deletes them with the rest of the assembly.

## Goals / Non-Goals

**Goals:**

- One module decides which actions belong in the log, their kind and their Spanish wording.
- A download that writes its own entry and returns the file in one transaction.
- A «Borrar datos» gate the database state alone can check.

**Non-Goals:**

- A screen that shows the log.
- Entries for #76, #83 and #85. Those changes add their actions to the catalogue.
- Signing or hashing the file.

## Decisions

### Store facts, render text at download

Rows keep an action code and metadata. A pure function maps a row to `{ time, kind, text }` at download. Write sites that concern a person add `personName` to metadata, taken from the session row in the same transaction, so a later correction does not rewrite history.

Rendering at download keeps the wording in one module and testable without a database. Storing rendered text instead would freeze wording mistakes into the rows.

### The catalogue is the log

`operator-log.ts` lists every action that appears in the log and its kind. Rows whose action is not in the catalogue stay in `audit_events` but are left out of the file. This excludes `round.result_computed`, which the results engine writes and which is not an operator action. UNCONFIRMED: leaving system computations out of the log.

`participant.resume_code_redeemed` is still written to `audit_events` but left out of the catalogue, because the spec does not record delegates' own actions. Adding it to the catalogue restores it in one line. UNCONFIRMED.

### Order by a sequence column

A migration adds `audit_events.sequence BIGSERIAL`. The file orders by `occurred_at`, then `sequence`. `round.opened` and the `presentation.changed` it triggers share a timestamp, so time alone does not define their order.

### Download is a POST that writes, then reads

`POST /moderator/assemblies/:id/log` with `{ "purpose": "review" | "delete" }` returns `text/csv`. In one transaction it locks the assembly row, counts the catalogue entries, inserts `log.downloaded` with `{ purpose, entryCount }` where `entryCount` includes the new entry, and reads all catalogue entries. POST fits because the request changes state.

### The gate compares counts

«Borrar datos», inside its existing transaction and lock, takes the newest catalogue entry by `(occurred_at, sequence)`. It requires `log.downloaded` with `purpose = 'delete'` and an `entryCount` equal to the current number of catalogue entries.

The count check covers a race the "last entry" check misses. `occurred_at` defaults to the transaction start, so an action whose transaction began before the download but committed after it can sort before the download entry and still be missing from the file. The count catches it.

### CSV for spreadsheets and text viewers

- UTF-8 with a byte order mark, so Excel keeps accented letters.
- Comma separator, CRLF line ends, every field quoted.
- Columns are «Hora», «Tipo» and «Acción».
- A field that starts with `=`, `+`, `-`, `@`, tab or carriage return gets a leading apostrophe, so a spreadsheet does not run a name as a formula.
- Times are `YYYY-MM-DD HH:mm:ss` in `America/Tegucigalpa`, because the server container runs in UTC. UNCONFIRMED.
- File name `registro-<assembly-slug>.csv`, matching the acta spreadsheet's naming.

### Web

The mesa shows «Descargar registro» next to the acta downloads. «Borrar datos» first downloads the log for «Borrar datos», then shows the existing typed confirmation. If the server refuses because of a later entry, the mesa says to download again.

## Risks / Trade-offs

- Rows written before this change have no `personName`. Their entries fall back to a generic wording such as «Participante retirado de la sala». No assembly data carries over between assemblies, so this matters only for tests.
- Comma separators open in one column on spreadsheets set to a locale with a comma decimal. Honduras uses a decimal point, so the default works there.
- The log is as trustworthy as the laptop. Anyone with database access can edit rows before the download. #80 records this limit.
