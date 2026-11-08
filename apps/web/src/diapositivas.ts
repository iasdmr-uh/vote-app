import { es } from './locale/es'
import { approvalText, displayOrder, percentOf, voteLabel } from './resultados'
import type { Position, PublicState } from './types'

/** Agenda UH 2026 slides on the projector (Figma 160:9, P1–P6). */
export type ResultSlide =
  | { kind: 'office'; title: string; name: string; votes: string; label: string }
  | { kind: 'decision'; title: string; verdict: string; approved: boolean; details: string }
  | { kind: 'committee'; title: string; rows: Array<{ label: string; count: number | null }>; members: string }

/** The org chart's puestos, all blank, for a server that does not send `positions` yet. */
export const DEFAULT_POSITIONS: Position[] = [
  ...es.projector.boardPositions.map((label, index) => ({ id: `board-${index}`, group: 'board' as const, label, sortOrder: index, custom: false, elected: null })),
  ...es.projector.departmentPositions.map((label, index) => ({ id: `department-${index}`, group: 'department' as const, label, sortOrder: index, custom: false, elected: null })),
]

export function positionsOf(state: PublicState | null | undefined, group: Position['group']) {
  const positions = state?.positions?.length ? state.positions : DEFAULT_POSITIONS
  return positions.filter((position) => position.group === group).sort((a, b) => a.sortOrder - b.sortOrder)
}

/**
 * The slide of a published round once its election or decision is settled: the elected office (P2),
 * the decision's verdict (P3) or the whole committee in order (P6). Null while it still needs another vote,
 * so the projector keeps the detailed count that shows who goes to the runoff.
 */
export function resultSlide(state: PublicState | null | undefined): ResultSlide | null {
  const round = state?.currentRound
  const outcome = state?.outcome
  if (!round || round.status !== 'published' || !outcome) return null
  const results = state?.results || []
  const base = state?.eligibleCount ?? outcome.base
  const countOf = (person: { optionId?: string; label: string }) =>
    (results.find((result) => person.optionId && result.optionId === person.optionId) || results.find((result) => result.label === person.label))?.count ?? null

  if (round.category === 'decision') {
    const ordered = displayOrder(round, results)
    const rule = approvalText(round, outcome)
    if (round.decisionFormat === 'boolean') {
      const approved = Boolean(outcome.approved)
      return { kind: 'decision', title: round.title, verdict: approved ? es.results.approved : es.results.notApproved, approved, details: [...ordered.map((result) => `${result.label} ${result.count}`), rule].join(' · ') }
    }
    const winner = results.find((result) => result.optionId === outcome.elected[0])
    if (!winner) return null
    return { kind: 'decision', title: round.title, verdict: winner.label, approved: true, details: [...ordered.slice(0, 4).map((result) => `${result.label} ${result.count}`), rule].join(' · ') }
  }

  const elected = state?.officialResult?.elected || []
  if (round.category === 'committee') {
    const members = Math.max(1, round.memberCount ?? round.electionSeats ?? 1)
    if (elected.length < members) return null
    return {
      kind: 'committee', title: round.title,
      rows: elected.map((person) => ({ label: person.label, count: countOf(person) })),
      members: es.results.members(members),
    }
  }

  const person = elected[0]
  if (!person) return null
  const count = countOf(person) ?? 0
  return { kind: 'office', title: round.title, name: person.label, votes: es.projector.officeVotes(count, base, percentOf(count, base)), label: [voteLabel(round), round.regionalSecretaryVotes ? es.results.regionalSecretaryNote : ''].filter(Boolean).join(' · ') }
}

/** P2: the elected name in one or two lines at most, as large as fits the 1680-wide column. */
export function nameSize(name: string) {
  return Math.max(84, Math.min(150, Math.floor(3000 / Math.max(1, name.length))))
}
