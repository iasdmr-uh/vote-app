## Why

Delegates cannot see the laptop that runs the vote. A record of each operator action, with its time, lets the Presiding Board answer doubts after the assembly. Issue #79 asks for it, and #55 depends on it to show the operator cannot steer a secret ballot unseen.

## What Changes

- The tool keeps an operator log. Every operator action that changes something adds one entry with its time, kind and a plain Spanish description that names the person it concerns.
- A vote that closes by itself is logged as closed by the system, with the reason. The entry itself is written when #83 is built.
- The operator downloads the log as a file that opens in a spreadsheet or a text viewer. The tool has no screen for it.
- Each download is itself logged. The last entry in the file is that download.
- «Borrar datos» is refused until the operator downloads the log for «Borrar datos» and nothing is logged after that download.
- The log never records how anyone voted or who voted, and never records delegates' own actions or viewing a screen.
- A delegate redeeming a «Reconectar dispositivo» code is left out of the log, because it is a delegate's own action.

## Capabilities

### New Capabilities

- `operator-log`: what the operator log records, what it never records, how it is downloaded, and how it gates «Borrar datos».

### Modified Capabilities

None. `openspec/specs/` has no specs yet.

## Impact

- API: a moderator endpoint that downloads the log, and a check in the «Borrar datos» endpoint.
- Database: `audit_events` gains a sequence column so entries written in one transaction keep a defined order.
- Voting service: write sites that concern a person also store that person's name at the time.
- Web: the mesa gets «Descargar registro», and «Borrar datos» first asks for the download.
- Later issues: #76 (official roster), #83 (closing by itself) and #85 (secretary QR code) add their own entries using this capability.
- Source issue: #79. Related: #55, #76, #83, #85.
