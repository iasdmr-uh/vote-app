export type LogKind = 'Entrada' | 'Votación' | 'Resultados' | 'Datos'

export interface LogRow {
  action: string
  occurredAt: Date
  sequence: bigint
  metadata: unknown
  roundTitle: string | null
}

export interface LogEntry {
  time: Date
  kind: LogKind
  text: string
}

export const LOG_TIME_ZONE = 'America/Tegucigalpa'

type Meta = Record<string, unknown>
type Describe = (meta: Meta, round: string) => string

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : '')
const person = (meta: Meta) => text(meta.personName) || 'Participante'
const titled = (prefix: string, round: string) => (round ? `${prefix}: ${round}` : prefix)

const CATALOGUE: Record<string, { kind: LogKind; describe: Describe }> = {
  'lobby.reopened': { kind: 'Entrada', describe: () => 'Sala reabierta' },
  'lobby.closed': { kind: 'Entrada', describe: () => 'Sala cerrada' },
  'assembly.join_code_rotated': { kind: 'Entrada', describe: () => 'Código de ingreso cambiado' },
  'participant.taken_out': { kind: 'Entrada', describe: (meta) => `${person(meta)} retirado de la sala` },
  'participant.returned': { kind: 'Entrada', describe: (meta) => `${person(meta)} readmitido en la sala` },
  'participant.voting_disabled': { kind: 'Entrada', describe: (meta) => `${person(meta)} inhabilitado para votar` },
  'participant.voting_enabled': { kind: 'Entrada', describe: (meta) => `${person(meta)} habilitado para votar` },
  'participant.removed': { kind: 'Entrada', describe: (meta) => `${person(meta)} quitado de la lista` },
  'participant.corrected': {
    kind: 'Entrada',
    describe: (meta) => (text(meta.newName) ? `Nombre de ${person(meta)} corregido a ${text(meta.newName)}` : `Nombre de ${person(meta)} corregido`),
  },
  'participant.resume_code_issued': { kind: 'Entrada', describe: (meta) => `Código para reconectar el dispositivo de ${person(meta)}` },
  'round.regional_secretary_added': { kind: 'Entrada', describe: (meta, round) => titled(`${text(meta.personName) || 'Secretario regional'} agregado como secretario regional`, round) },
  'round.regional_secretary_removed': { kind: 'Entrada', describe: (_meta, round) => titled('Secretario regional quitado', round) },
  'position.added': { kind: 'Votación', describe: (meta) => titled('Puesto agregado', text(meta.label)) },
  'round.prepared': { kind: 'Votación', describe: (_meta, round) => titled('Votación preparada', round) },
  'round.opened': { kind: 'Votación', describe: (_meta, round) => titled('Votación abierta', round) },
  'round.closed': { kind: 'Votación', describe: (_meta, round) => titled('Votación cerrada', round) },
  'round.repeated': { kind: 'Votación', describe: (_meta, round) => titled('Votación repetida', round) },
  'round.runoff_discarded': { kind: 'Votación', describe: (_meta, round) => titled('Desempate descartado', round) },
  'round.annulled': { kind: 'Votación', describe: (meta, round) => `${titled('Votación anulada', round)}. Motivo: ${text(meta.reason)}` },
  'round.candidate_added': { kind: 'Votación', describe: (meta, round) => `${titled('Candidato agregado', text(meta.label))}${round ? ` en ${round}` : ''}` },
  'round.candidate_removed': { kind: 'Votación', describe: (meta, round) => `${titled('Candidato quitado', text(meta.label))}${round ? ` de ${round}` : ''}` },
  'round.results_published': { kind: 'Resultados', describe: (_meta, round) => titled('Resultados publicados', round) },
  'presentation.changed': {
    kind: 'Resultados',
    describe: (meta) => (meta.active === true ? 'Pantalla pública: presentación de oficiales' : 'Pantalla pública: presentación cerrada'),
  },
  'assembly.created_and_lobby_opened': { kind: 'Datos', describe: () => 'Asamblea creada y sala abierta' },
  'assembly.completed': { kind: 'Datos', describe: () => 'Asamblea finalizada' },
  'log.downloaded': { kind: 'Datos', describe: (meta) => (meta.purpose === 'delete' ? 'Registro descargado para «Borrar datos»' : 'Registro descargado') },
}

export const LOGGED_ACTIONS: ReadonlySet<string> = new Set(Object.keys(CATALOGUE))

export function logEntryOf(row: LogRow): LogEntry | null {
  const entry = CATALOGUE[row.action]
  if (!entry) return null
  const meta = row.metadata && typeof row.metadata === 'object' ? (row.metadata as Meta) : {}
  return { time: row.occurredAt, kind: entry.kind, text: entry.describe(meta, text(row.roundTitle)) }
}

export function compareLogRows(a: LogRow, b: LogRow) {
  const byTime = a.occurredAt.getTime() - b.occurredAt.getTime()
  if (byTime !== 0) return byTime
  return a.sequence < b.sequence ? -1 : a.sequence > b.sequence ? 1 : 0
}

const timeFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: LOG_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

function localTime(value: Date) {
  const part = Object.fromEntries(timeFormat.formatToParts(value).map((item) => [item.type, item.value]))
  return `${part.year}-${part.month}-${part.day} ${part.hour}:${part.minute}:${part.second}`
}

function csvField(value: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}

export function operatorLogCsv(rows: LogRow[]) {
  const lines = [['Hora', 'Tipo', 'Acción']]
  for (const row of [...rows].sort(compareLogRows)) {
    const entry = logEntryOf(row)
    if (entry) lines.push([localTime(entry.time), entry.kind, entry.text])
  }
  return `﻿${lines.map((line) => line.map(csvField).join(',')).join('\r\n')}\r\n`
}
