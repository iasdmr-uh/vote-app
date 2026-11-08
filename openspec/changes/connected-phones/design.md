## Context

- Phones, the projector and the mesa hold one Socket.IO connection each on `/events`. A phone's room is `participant:<participantId>`, so every device that shares a session lands in the same room.
- Socket.IO runs with default heartbeats (25 s interval, 20 s timeout). A silent drop takes up to 45 s to notice on either side.
- The phone shows «Conexión interrumpida · Intentando reconectar…» as soon as its socket disconnects.
- The base of a vote is computed in `VotingService` from active sessions plus the regional secretary when the vote adds them. It is frozen when the vote closes.
- Events are notices. Clients recover state over HTTP after connecting.
- Lanes A, B and C edit `voting.service.ts`. This change keeps its diff there to one small method.

## Goals / Non-Goals

**Goals:**

- Detect silent drops within the spec's 10-second bound.
- Keep presence out of the database and out of logs.
- Reuse the existing base rule instead of restating it.

**Non-Goals:**

- Telling anyone who is offline.
- Presence outside an open vote.
- Persisting presence across an API restart. After a restart every phone reconnects and is counted again.

## Decisions

### Heartbeat of 3 s interval and 3 s timeout

The server detects a silent drop within 6 s, and so does the phone. With the 3 s grace this stays under 10 s. About 70 phones sending a small ping every 3 s is negligible on a LAN.

Alternative considered: an application-level heartbeat event. It duplicates what Socket.IO already does and would need a client-to-server event, which the realtime contract forbids.

### In-memory presence tracker in the realtime module

`ConnectionPresence` keeps, per assembly, a count of live sockets per participant id. The gateway adds on connect and removes on disconnect. When a participant's last socket goes, the tracker waits the 3 s grace before it reports the person offline. A reconnect within the grace cancels the timer, so nothing changes. The clock and timer are passed in, so tests drive time directly.

Alternative considered: Socket.IO room membership lookups on demand. They cannot express the grace period and give no change notifications.

### Count computed outside the gateway

The realtime module stays free of domain imports. A `ConnectionCountService` in the voting module listens to presence changes, asks `VotingService.openRoundBase(assemblyId)` for the open vote and the participant ids in its base, and computes X with a pure function `connectedInBase(baseIds, onlineIds)`. It emits `connection.count` `{ roundId, connected, base }` to the public and moderator rooms only when the value changes.

`openRoundBase` returns null when no vote is open. It uses the same session filters as the existing base count, and the existing count derives from it, so the base rule stays in one place.

### HTTP state carries the count

The public-state and moderator state responses gain `connection: { connected, base }` while a vote is open, and omit it otherwise. The controllers add it from `ConnectionCountService`, which keeps the change out of `VotingService` state builders. Clients already refresh on `round.state`, so opening, closing and annulling a vote need no extra event.

### Phone signal with a 3 s grace

`useAssembly` derives one phone signal from `realtimeConnected`. It turns connected at once and turns down only after 3 s of continuous disconnection. During an open vote the phone shows «Conectado» when the signal is connected and the existing notice when it is down. The grace also applies to the phone notice outside a vote, because the flicker problem is the same there. The projector and mesa notices keep their current behavior.

### Display

The projector and the mesa show "X de Y conectados" next to "X de Y han votado" while a vote is open, from the event or the HTTP state. Neither renders anything per person.

## Risks / Trade-offs

- [Phones on a locked screen drop their socket and count as offline] → The spec states this as an accepted limit. The count says connected, not present.
- [Shorter heartbeats raise radio use on phones] → 3 s on a local Wi-Fi network is small for a session of a few hours.
- [A presence change and a base change race] → Each recount reads the base fresh and emits only on change. Clients also recover over HTTP.
- [API restart loses presence] → Phones reconnect automatically and are counted again within seconds.
- [Logs could leak who dropped] → The tracker and gateway log nothing per participant. A test checks that no participant id reaches the logger.

## Migration Plan

No data migration. Rollback is a revert.
