import assert from 'node:assert/strict'
import test from 'node:test'
import { LOGGED_ACTIONS, canEraseWithLog, logEntryOf, operatorLogCsv, type LogRow } from '../../src/voting/operator-log.js'

const at = new Date('2026-11-08T20:15:30.000Z')
const row = (action: string, metadata: Record<string, unknown> | null = null, extra: Partial<LogRow> = {}): LogRow =>
  ({ action, occurredAt: at, sequence: 1n, metadata, roundTitle: null, ...extra })

test('an entry about a person names them as recorded at the time', () => {
  assert.deepEqual(logEntryOf(row('participant.taken_out', { participantId: 'p', personName: 'Delegado 12' })), {
    time: at, kind: 'Entrada', text: 'Delegado 12 retirado de la sala',
  })
  assert.equal(logEntryOf(row('participant.voting_disabled', { personName: 'Delegado 12' }))?.text, 'Delegado 12 inhabilitado para votar')
  assert.equal(logEntryOf(row('participant.returned', { personName: 'Delegado 12' }))?.text, 'Delegado 12 readmitido en la sala')
})

test('an entry written before names were stored falls back to a generic person', () => {
  assert.equal(logEntryOf(row('participant.taken_out', { participantId: 'p' }))?.text, 'Participante retirado de la sala')
})

test('each logged action has exactly one of the four kinds', () => {
  const kinds = new Set(['Entrada', 'Votación', 'Resultados', 'Datos'])
  for (const action of LOGGED_ACTIONS) {
    const entry = logEntryOf(row(action, { personName: 'Delegado 1', reason: 'x', purpose: 'review', active: true, label: 'x' }))
    assert.ok(entry && kinds.has(entry.kind), action)
  }
  assert.equal(logEntryOf(row('participant.voting_disabled'))?.kind, 'Entrada')
  assert.equal(logEntryOf(row('round.annulled', { reason: 'x' }))?.kind, 'Votación')
  assert.equal(logEntryOf(row('round.results_published'))?.kind, 'Resultados')
  assert.equal(logEntryOf(row('results.registered'))?.kind, 'Resultados')
  assert.equal(logEntryOf(row('log.downloaded', { purpose: 'review' }))?.kind, 'Datos')
  assert.equal(logEntryOf(row('assembly.created_and_lobby_opened'))?.kind, 'Datos')
})

test('an annulment keeps its reason and names the vote', () => {
  const entry = logEntryOf(row('round.annulled', { reason: 'Error en la papeleta' }, { roundTitle: 'Presidente' }))
  assert.equal(entry?.text, 'Votación anulada: Presidente. Motivo: Error en la papeleta')
})

test('a download for «Borrar datos» says so', () => {
  assert.equal(logEntryOf(row('log.downloaded', { purpose: 'delete' }))?.text, 'Registro descargado para «Borrar datos»')
  assert.equal(logEntryOf(row('log.downloaded', { purpose: 'review' }))?.text, 'Registro descargado')
})

test('system computations and delegate actions are left out of the log', () => {
  assert.equal(logEntryOf(row('round.result_computed', { electedLabels: ['Isaías'] })), null)
  assert.equal(logEntryOf(row('participant.resume_code_redeemed', { participantId: 'p' })), null)
  assert.ok(!LOGGED_ACTIONS.has('round.result_computed'))
})

test('the file opens in a spreadsheet with accents, a header and Honduras time', () => {
  const csv = operatorLogCsv([row('participant.taken_out', { personName: 'Delegado 12' })])
  assert.ok(csv.startsWith('﻿'))
  const lines = csv.slice(1).split('\r\n')
  assert.equal(lines[0], '"Hora","Tipo","Acción"')
  assert.equal(lines[1], '"2026-11-08 14:15:30","Entrada","Delegado 12 retirado de la sala"')
})

test('the file orders by time, then by recording order, whatever order the rows arrive in', () => {
  const rows = [
    row('presentation.changed', { active: false }, { sequence: 3n }),
    row('round.opened', null, { sequence: 2n, roundTitle: 'Presidente' }),
    row('lobby.closed', null, { sequence: 9n, occurredAt: new Date('2026-11-08T20:00:00.000Z') }),
  ]
  const actions = operatorLogCsv(rows).slice(1).split('\r\n').slice(1, 4).map((line) => line.split('","')[2])
  assert.deepEqual(actions, ['Sala cerrada"', 'Votación abierta: Presidente"', 'Pantalla pública: presentación cerrada"'])
})

test('a name that looks like a formula stays text, and quotes are escaped', () => {
  const csv = operatorLogCsv([row('participant.taken_out', { personName: '=HYPERLINK("x")' })])
  assert.ok(csv.includes(`"'=HYPERLINK(""x"") retirado de la sala"`))
})

test('the file leaves out rows that are not in the log', () => {
  const csv = operatorLogCsv([row('round.result_computed', { electedLabels: ['Isaías'] })])
  assert.equal(csv, '﻿"Hora","Tipo","Acción"\r\n')
})

test('«Borrar datos» needs the newest entry to be a download for it with every entry recorded so far', () => {
  const download = (purpose: string, entryCount: number) => ({ action: 'log.downloaded', metadata: { purpose, entryCount } })
  assert.equal(canEraseWithLog(null, 0), false, 'nothing logged')
  assert.equal(canEraseWithLog({ action: 'assembly.completed', metadata: {} }, 3), false, 'no download yet')
  assert.equal(canEraseWithLog(download('delete', 4), 4), true, 'downloaded, then erased')
  assert.equal(canEraseWithLog({ action: 'presentation.changed', metadata: { active: true } }, 5), false, 'an action after the download')
  assert.equal(canEraseWithLog(download('review', 4), 4), false, 'a plain download does not count')
  assert.equal(canEraseWithLog(download('delete', 4), 5), false, 'an entry missing from the downloaded file')
})

test('an entry whose vote was later deleted keeps the title stored with it', () => {
  const entry = logEntryOf(row('round.regional_secretary_added', { personName: 'Marta Regional', roundTitle: 'Presidencia' }, { roundTitle: null }))
  assert.equal(entry?.text, 'Marta Regional agregado como secretario regional: Presidencia')
})

test('adding a result to the roster names its election', () => {
  assert.equal(logEntryOf(row('results.registered', null, { roundTitle: 'Comisión de Finanzas' }))?.text, 'Agregado a oficiales: Comisión de Finanzas')
})

test('a vote that closed by itself names the system and the reason', () => {
  const entry = logEntryOf(row('round.closed_automatically', { reason: 'everyone_voted' }, { roundTitle: 'Presidente' }))
  assert.deepEqual(entry, { time: at, kind: 'Votación', text: 'Votación cerrada por el sistema: Presidente. Motivo: todos votaron' })
})
