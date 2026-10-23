import type { RoundRecord } from './types'
import type { Cell } from './xlsx'

type Counted = { count: number }
type Turnout = { recordedCount?: number; participationCount?: number; eligibleCount?: number }

export function rankOf(results: Counted[], index: number) {
  return results[index] ? `${index + 1}.` : ''
}

export function isTied(results: Counted[], index: number) {
  const result = results[index]
  if (!result || result.count === 0) return false
  return results.some((other, otherIndex) => otherIndex !== index && other.count === result.count)
}

export function percentOf(count: number, eligible?: number | null) {
  return eligible && eligible > 0 ? Math.round((count / eligible) * 100) : 0
}

export function turnoutOf(source?: Turnout | null) {
  return { recorded: source?.recordedCount ?? source?.participationCount ?? 0, eligible: source?.eligibleCount ?? 0 }
}

export function votedText(recorded: number, eligible?: number | null) {
  const verb = recorded === 1 ? 'votó' : 'votaron'
  return eligible ? `${recorded} de ${eligible} ${verb}` : `${recorded} ${verb}`
}

export function rankedResults<T extends Counted>(results: T[], eligible?: number | null) {
  const sorted = [...results].sort((a, b) => b.count - a.count)
  return sorted.map((result, index) => ({ ...result, rank: index + 1, tied: isTied(sorted, index), percent: percentOf(result.count, eligible) }))
}

export function decisionTie(target: RoundRecord) {
  const seats = target.category === 'committee' ? Math.max(1, target.electionSeats ?? target.memberCount ?? 1) : 1
  const ranked = [...(target.results?.length ? target.results : target.privateResults || [])].sort((a, b) => b.count - a.count)
  const edge = ranked[seats - 1]?.count ?? 0
  if (ranked.length <= seats || edge === 0 || ranked[seats].count !== edge) return null
  const tied = ranked.filter((result) => result.count === edge)
  const openSeats = seats - ranked.filter((result) => result.count > edge).length
  const names = formatNames(tied.map((result) => result.label))
  const where = seats === 1 ? 'en el primer lugar' : openSeats === 1 ? 'por el último cupo' : `por los últimos ${openSeats} cupos`
  return { tied, count: edge, openSeats, text: `Empate ${where}: ${names}, ${edge} votos cada uno.` }
}

export function formatNames(names: string[]) {
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}` : names[0] || ''
}

export function resultPercent(results: Counted[], count: number, voters?: number | null) {
  const total = voters ?? results.reduce((sum, result) => sum + result.count, 0)
  return total ? Math.round((count / total) * 100) : 0
}

export function committeeVoters(target: { category?: string; participationCount?: number } | undefined, voters = target?.participationCount) {
  return target?.category === 'committee' ? voters ?? null : null
}

export function countsOf(target: RoundRecord) {
  return target.results?.length ? target.results : target.privateResults || []
}

export function voteCountOf(target: RoundRecord, option: { id: string; label: string }) {
  const counts = countsOf(target)
  return (counts.find((result) => result.optionId === option.id) || counts.find((result) => result.label === option.label))?.count ?? 0
}

export const ACTA_SHEET_HEADER: Cell[] = ['Papeleta', 'Estado', 'Participación', 'Lugar', 'Opción', 'Votos', '%', 'Empate', 'Declarada electa']

export function actaSheetRows(rounds: RoundRecord[], statusLabels: Record<string, string> = {}) {
  const rows: Cell[][] = [ACTA_SHEET_HEADER]
  for (const item of rounds) {
    const status = statusLabels[item.status] || item.status
    const { recorded, eligible } = turnoutOf(item)
    const participation = item.recordedCount !== undefined || item.participationCount !== undefined ? votedText(recorded, eligible) : ''
    const elected = new Set((item.officialResult?.elected || []).map((person) => person.optionId))
    if (item.results?.length) {
      for (const result of rankedResults(item.results, eligible)) {
        rows.push([item.title, status, participation, result.rank, result.label, result.count, eligible ? result.percent : '', result.tied ? 'sí' : '', elected.has(result.optionId) ? 'sí' : ''])
      }
    } else {
      rows.push([item.title, item.status === 'annulled' ? `${status}: ${item.annulReason || ''}` : `${status} (conteo no publicado)`, participation, '', '', '', '', '', (item.officialResult?.elected || []).map((person) => person.label).join('; ')])
    }
  }
  return rows
}
