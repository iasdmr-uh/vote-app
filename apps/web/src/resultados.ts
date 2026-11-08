import type { Outcome, Position, RoundRecord } from './types'
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

export function connectedText(connected: number, base: number) {
  return `${connected} de ${base} conectados`
}

export function votedText(recorded: number, eligible?: number | null) {
  const verb = recorded === 1 ? 'votó' : 'votaron'
  return eligible ? `${recorded} de ${eligible} ${verb}` : `${recorded} ${verb}`
}

/** Base frozen at close minus votes cast: inhabilitados who did not vote count here too. */
export function notVotedOf(recorded: number, eligible?: number | null) {
  return Math.max(0, (eligible ?? 0) - recorded)
}

export function notVotedText(recorded: number, eligible?: number | null) {
  const missing = notVotedOf(recorded, eligible)
  return `${missing} ${missing === 1 ? 'no votó' : 'no votaron'}`
}

export function rankedResults<T extends Counted>(results: T[], eligible?: number | null) {
  const sorted = [...results].sort((a, b) => b.count - a.count)
  return sorted.map((result, index) => ({ ...result, rank: index + 1, tied: isTied(sorted, index), percent: percentOf(result.count, eligible) }))
}

export function decisionTie(target: RoundRecord) {
  const seats = target.category === 'committee' ? Math.max(1, target.electionSeats ?? target.memberCount ?? 1) : 1
  const ranked = [...(target.results || [])].sort((a, b) => b.count - a.count)
  const edge = ranked[seats - 1]?.count ?? 0
  if (ranked.length <= seats || edge === 0 || ranked[seats].count !== edge) return null
  const tied = ranked.filter((result) => result.count === edge)
  const openSeats = seats - ranked.filter((result) => result.count > edge).length
  const names = formatNames(tied.map((result) => result.label))
  const where = seats === 1 ? 'en el primer lugar' : openSeats === 1 ? 'por el último cupo' : `por los últimos ${openSeats} cupos`
  return { tied, count: edge, openSeats, text: `Empate ${where}: ${names}, ${edge} votos cada uno.` }
}

/** Badge of a candidate in a computed result: elected, or passing to the runoff. */
export const RESULT_WORDING = {
  preparing: 'Preparando el resultado',
  continuing: 'Pasan a la siguiente votación',
  final: 'Resultado final',
  elected: 'Electos',
  electedSoFar: 'Electos hasta ahora',
  approved: 'Aprobada',
  notApproved: 'No aprobada',
  register: 'Agregar a oficiales',
  registered: 'Registrado como oficial',
} as const

export function outcomeTag(outcome: Outcome | undefined, optionId?: string) {
  if (!outcome || !optionId) return null
  if (outcome.elected.includes(optionId)) return 'elected' as const
  return outcome.runoff.includes(optionId) ? 'runoff' as const : null
}

/** Ballots only hold typed names, so the badge never guesses the gender. */
export function electedText(_name?: string) {
  return 'Electo/a'
}

export const REGIONAL_SECRETARY_NOTE = 'Con la secretaría regional'

export function voteResultText(target: RoundRecord, optionId?: string) {
  const outcome = target.outcome
  if (!outcome || !optionId || (isDecision(target) && target.decisionFormat === 'boolean')) return ''
  if (outcome.elected.includes(optionId)) return winnerText(target, '')
  return outcome.runoff.includes(optionId) ? 'Pasa' : 'No continúa'
}

export function electedInVote(target: RoundRecord) {
  const elected = target.outcome?.elected ?? []
  const counts = countsOf(target)
  return elected.map((optionId) => counts.find((result) => result.optionId === optionId)?.label).filter((label): label is string => Boolean(label))
}

export function electedSoFar(target: { category?: string; memberCount?: number | null } | null | undefined, elected: Array<{ label: string }> | undefined, final: unknown) {
  const seats = Math.max(1, target?.memberCount ?? 1)
  if (final || target?.category !== 'committee' || !elected?.length || elected.length >= seats) return null
  return { title: `${RESULT_WORDING.electedSoFar} · ${elected.length} de ${seats}`, names: elected.map((person) => person.label).join(' · ') }
}

export function completedCommittee(target: RoundRecord, rounds: RoundRecord[]) {
  const root = rounds.find((item) => item.id === (target.committeeRootRoundId || target.id))
  const members = root?.officialResult?.elected ?? []
  if (root?.category !== 'committee' || members.length < Math.max(1, root.memberCount ?? 1)) return []
  return target.outcome?.elected.includes(members.at(-1)!.optionId) ? members.map((person) => person.label) : []
}

/** "DESEMPATE · 2.ª VOTACIÓN" for a runoff, nothing for the first vote. Annulled votes are not counted in the number. */
export function voteLabel(target?: { voteNumber?: number; runoff?: boolean } | null) {
  const number = target?.voteNumber ?? 1
  if (number <= 1) return ''
  return `${target?.runoff ? 'DESEMPATE · ' : ''}${number}.ª VOTACIÓN`
}

/** "Mayoría: 20", or "3 integrantes · Mayoría: 20" for a committee ("2 puestos" in its runoffs). */
export function majorityText(target: DecisionTarget & { runoff?: boolean }, outcome?: Outcome) {
  if (!outcome) return ''
  if (isDecision(target)) return approvalText(target, outcome)
  const majority = `Mayoría: ${outcome.threshold}`
  if (target.category !== 'committee') return majority
  const seats = target.runoff
    ? `${outcome.seats} ${outcome.seats === 1 ? 'puesto' : 'puestos'}`
    : `${outcome.seats} ${outcome.seats === 1 ? 'integrante' : 'integrantes'}`
  return `${seats} · ${majority}`
}

type DecisionTarget = { category?: string; decisionFormat?: string | null; approvalRule?: string | null }

export function isDecision(target?: DecisionTarget | null) {
  return target?.category === 'decision'
}

/** "Se aprueba con 3/4 · 29 votos" or "Se aprueba con mayoría simple · 20 votos" for a decision. */
export function approvalText(target: DecisionTarget, outcome?: Outcome) {
  if (!outcome) return ''
  const rule = (outcome.rule ?? target.approvalRule) === 'three_quarters' ? '3/4' : 'mayoría simple'
  return `Se aprueba con ${rule} · ${outcome.threshold} ${outcome.threshold === 1 ? 'voto' : 'votos'}`
}

/**
 * A decision's result: "Aprobada" / "No aprobada" for A favor / En contra, the winning option's label
 * when one reached the rule, or nothing while it repeats between the most voted.
 */
export function decisionVerdict(target: DecisionTarget, outcome?: Outcome, results: Array<{ optionId?: string; label: string }> = []) {
  if (!isDecision(target) || !outcome) return ''
  if (target.decisionFormat === 'boolean') return outcome.approved ? 'Aprobada' : 'No aprobada'
  const winner = outcome.elected[0]
  return winner ? results.find((result) => result.optionId === winner)?.label ?? '' : ''
}

/** Badge of the option that won: "Aprobada" in a decision, Electo/a in an election. */
export function winnerText(target: DecisionTarget, label: string) {
  return isDecision(target) ? 'Aprobada' : electedText(label)
}

/** A boolean decision keeps its ballot order (A favor first); everything else ranks by votes. */
export function displayOrder<T extends { label: string; count: number }>(target: DecisionTarget | null | undefined, results: T[]) {
  if (target?.category === 'decision' && target.decisionFormat === 'boolean') return [...results].sort((a, b) => Number(b.label === 'A favor') - Number(a.label === 'A favor'))
  return [...results].sort((a, b) => b.count - a.count)
}

export function formatNames(names: string[]) {
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}` : names[0] || ''
}

export function countsOf(target: RoundRecord) {
  return target.results || []
}

export function verdictOf(target: RoundRecord) {
  return decisionVerdict(target, target.outcome, countsOf(target))
}

export function voteCountOf(target: RoundRecord, option: { id: string; label: string }) {
  const counts = countsOf(target)
  return (counts.find((result) => result.optionId === option.id) || counts.find((result) => result.label === option.label))?.count ?? 0
}

export const ACTA_SHEET_HEADER: Cell[] = ['Papeleta', 'Estado', 'Participación', 'Lugar', 'Opción', 'Votos', '%', 'Empate', 'Resultado']

export function actaSheetRows(rounds: RoundRecord[], statusLabels: Record<string, string> = {}) {
  const rows: Cell[][] = [ACTA_SHEET_HEADER]
  for (const item of rounds) {
    const status = statusLabels[item.status] || item.status
    const ballot = [item.title, voteLabel(item)].filter(Boolean).join(' · ')
    const { recorded, eligible } = turnoutOf(item)
    const counted = item.recordedCount !== undefined || item.participationCount !== undefined
    const participation = counted ? [votedText(recorded, eligible), eligible ? notVotedText(recorded, eligible) : '', item.regionalSecretaryVotes ? REGIONAL_SECRETARY_NOTE : ''].filter(Boolean).join(' · ') : ''
    const verdict = decisionVerdict(item, item.outcome, item.results)
    const members = completedCommittee(item, rounds)
    const state = [status, verdict, members.length ? `Comisión completa: ${members.join(', ')}` : ''].filter(Boolean).join(' · ')
    if (item.results?.length) {
      for (const result of rankedResults(item.results, eligible)) {
        rows.push([ballot, state, participation, result.rank, result.label, result.count, eligible ? result.percent : '', result.tied ? 'sí' : '', voteResultText(item, result.optionId)])
      }
    } else {
      rows.push([ballot, item.status === 'annulled' ? `${status}: ${item.annulReason || ''}` : `${status} (conteo no publicado)`, participation, '', '', '', '', '', ''])
    }
  }
  return rows
}

export function votesText(count: number) {
  return `${count} ${count === 1 ? 'voto' : 'votos'}`
}

export type ActaTone = 'vote' | 'annulled' | 'approved' | 'rejected'

/** Header tag of a vote in the printed acta: "1.ª VOTACIÓN", "DESEMPATE · 2.ª VOTACIÓN", "ANULADA" or "DECISIÓN · APROBADA". */
export function actaKind(target: RoundRecord, voteNumber = target.voteNumber ?? 1): { text: string; tone: ActaTone } {
  if (target.status === 'annulled') return { text: 'ANULADA', tone: 'annulled' }
  if (isDecision(target)) {
    if (!target.outcome) return { text: 'DECISIÓN', tone: 'vote' }
    return target.outcome.approved ? { text: 'DECISIÓN · APROBADA', tone: 'approved' } : { text: 'DECISIÓN · NO APROBADA', tone: 'rejected' }
  }
  return { text: voteLabel({ voteNumber, runoff: target.runoff }) || '1.ª VOTACIÓN', tone: 'vote' }
}

/**
 * The line under a vote's title: "3 integrantes · 36 de 38 votaron · 2 no votaron · Mayoría: 20",
 * "Se aprueba con 3/4 · 29 votos · …", or the reason of an annulled vote.
 */
export function actaMetaText(target: RoundRecord) {
  if (target.status === 'annulled') return target.annulReason || ''
  const parts: string[] = []
  if (isDecision(target)) parts.push(approvalText(target, target.outcome))
  else if (target.category === 'committee') {
    const seats = target.outcome?.seats ?? (target.runoff ? target.electionSeats : target.memberCount) ?? 1
    parts.push(target.runoff ? `${seats} ${seats === 1 ? 'puesto' : 'puestos'}` : `${seats} ${seats === 1 ? 'integrante' : 'integrantes'}`)
  }
  if (target.participationCount !== undefined || target.recordedCount !== undefined) {
    const { recorded, eligible } = turnoutOf(target)
    parts.push(votedText(recorded, eligible))
    if (eligible) parts.push(notVotedText(recorded, eligible))
  }
  if (target.regionalSecretaryVotes) parts.push(REGIONAL_SECRETARY_NOTE)
  if (target.outcome && !isDecision(target)) parts.push(`Mayoría: ${target.outcome.threshold}`)
  return parts.filter(Boolean).join(' · ')
}

export type ActaRow = { key: string; rank: number; label: string; count: number; percent: number | null; tag: 'Electo/a' | 'Aprobada' | 'Desempate' | 'Empate' | null; winner: boolean }

/** Counted options of a vote, in acta order, with votes, % of the habilitados and their tag. */
export function actaRows(target: RoundRecord): ActaRow[] {
  const results = target.results || []
  const { eligible } = turnoutOf(target)
  const ranked = displayOrder(target, results)
  const byVotes = [...results].sort((a, b) => b.count - a.count)
  const booleanApproved = isDecision(target) && target.decisionFormat === 'boolean' && target.outcome?.approved
  return ranked.map((result, index) => {
    const outcome = outcomeTag(target.outcome, result.optionId)
    const winner = outcome === 'elected' || Boolean(booleanApproved && result.label === 'A favor')
    const tied = !target.outcome && isTied(byVotes, byVotes.indexOf(result))
    const tag = winner ? winnerText(target, result.label) as ActaRow['tag'] : outcome === 'runoff' ? 'Desempate' : tied ? 'Empate' : null
    return { key: result.optionId || result.label, rank: index + 1, label: result.label, count: result.count, percent: eligible ? percentOf(result.count, eligible) : null, tag, winner }
  })
}

/** "38 habilitados · 8 votaciones · 1 anulada" at the top of the acta. */
export function actaSummary(rounds: RoundRecord[], habilitados: number) {
  const annulled = rounds.filter((item) => item.status === 'annulled').length
  return [
    `${habilitados} ${habilitados === 1 ? 'habilitado' : 'habilitados'}`,
    `${rounds.length} ${rounds.length === 1 ? 'votación' : 'votaciones'}`,
    annulled ? `${annulled} ${annulled === 1 ? 'anulada' : 'anuladas'}` : '',
  ].filter(Boolean).join(' · ')
}

/** Org chart of the officers: board with its first two on top, departments in rows of two. */
export function orgChart(positions: Position[]) {
  const sorted = [...positions].sort((a, b) => a.sortOrder - b.sortOrder)
  const board = sorted.filter((position) => position.group === 'board')
  const departments = sorted.filter((position) => position.group === 'department')
  const rows: Position[][] = []
  for (let index = 0; index < departments.length; index += 2) rows.push(departments.slice(index, index + 2))
  return { boardTop: board.slice(0, 2), boardBottom: board.slice(2), departmentRows: rows }
}
