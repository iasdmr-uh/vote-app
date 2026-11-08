## Why

A phone can drop during a vote without its owner noticing. No device can reconnect during a vote (#78), so a phone that stays down may mean the vote has to be annulled and repeated. Delegates need to see that their own phone is connected, and the room needs to see how many phones are. Issue: #84.

## What Changes

- While a vote is open, each phone shows «Conectado» when the server can reach it, and the existing connection notice when it cannot. A brief drop that recovers on its own changes nothing on screen.
- While a vote is open, the public screen and the operator console show "X de Y conectados". Y is the base of the vote. X counts people in the base with at least one connected phone.
- The count disappears when the vote closes or is annulled.
- The operator console shows no list of who is offline.
- The server detects a silent drop within seconds, by checking each connection more often than today.

## Capabilities

### New Capabilities

- `vote-connection-status`: what phones, the public screen and the operator console show about phone connections while a vote is open.

### Modified Capabilities

None.

## Impact

- API realtime gateway: track which participants have a live connection, and publish an aggregate count to the public and moderator channels.
- API state endpoints: the public and moderator state include the count while a vote is open, so clients recover it over HTTP.
- Socket.IO server settings: shorter heartbeat interval and timeout.
- Web: «Conectado» and the delayed connection notice on phones, "X de Y conectados" on the projector and in the mesa.
- Related: #55 (only participation counts while a vote is open), #76, #78, #83.
