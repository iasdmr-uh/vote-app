import { RESULT_WORDING, chainVoteNumber, countsOf, decisionVerdict, displayOrder, formatNames, isDecision, majorityText, outcomeTag, voteLabel, winnerText } from './resultados'
import type { RoundRecord } from './types'

export type ProgressState = 'open' | 'counting' | 'counted' | 'annulled'

export type ProgressRow = { key: string; label: string; count: number; tag: string | null }

export type ProgressColumn = {
  id: string
  heading: string
  state: ProgressState
  stateText: string
  reason: string
  options: string[]
  rows: ProgressRow[]
  needed: string
  outcome: string
  nextStep: string
}

export type ProgressTab = { id: string; title: string; columns: ProgressColumn[] }

const STATE_TEXT: Record<ProgressState, string> = {
  open: 'Votación abierta',
  counting: RESULT_WORDING.preparing,
  counted: '',
  annulled: 'Anulada',
}

const NEXT_STEP = {
  electionComplete: 'Elección completa',
  decided: 'Decisión tomada',
  runoff: 'Corresponde desempate',
  boardDecides: 'La Mesa Directiva decide cómo continuar',
}

function tabIdOf(round: RoundRecord) {
  return round.committeeRootRoundId || round.id
}

export function latestTabId(rounds: RoundRecord[]) {
  const latest = [...rounds].reverse().find((round) => round.status !== 'draft')
  return latest ? tabIdOf(latest) : ''
}

export function voteProgress(rounds: RoundRecord[]): ProgressTab[] {
  const tabs = new Map<string, ProgressTab>()
  for (const round of rounds) {
    if (round.status === 'draft') continue
    const rootId = tabIdOf(round)
    const root = rounds.find((item) => item.id === rootId) ?? round
    const tab = tabs.get(rootId) ?? { id: rootId, title: root.title, columns: [] }
    tab.columns.push(progressColumn(round, rounds))
    tabs.set(rootId, tab)
  }
  return [...tabs.values()]
}

function progressColumn(round: RoundRecord, rounds: RoundRecord[]): ProgressColumn {
  const state = stateOf(round)
  const counted = state === 'counted'
  return {
    id: round.id,
    heading: voteLabel({ voteNumber: chainVoteNumber(round, rounds), runoff: round.runoff }) || '1.ª VOTACIÓN',
    state,
    stateText: STATE_TEXT[state],
    reason: state === 'annulled' ? round.annulReason ?? '' : '',
    options: round.options.map((option) => option.label),
    rows: counted ? rowsOf(round) : [],
    needed: counted ? majorityText(round, round.outcome) : '',
    outcome: counted ? outcomeText(round) : '',
    nextStep: counted ? nextStepOf(round) : '',
  }
}

function stateOf(round: RoundRecord): ProgressState {
  if (round.status === 'annulled') return 'annulled'
  if (round.status === 'open') return 'open'
  return round.status === 'published' && round.outcome && countsOf(round).length ? 'counted' : 'counting'
}

function rowsOf(round: RoundRecord): ProgressRow[] {
  return displayOrder(round, countsOf(round)).map((result) => {
    const tag = outcomeTag(round.outcome, result.optionId)
    return {
      key: result.optionId || result.label,
      label: result.label,
      count: result.count,
      tag: tag === 'elected' ? winnerText(round, result.label) : tag === 'runoff' ? 'Desempate' : null,
    }
  })
}

function namesOf(round: RoundRecord, optionIds: string[]) {
  const counts = countsOf(round)
  return optionIds.map((optionId) => counts.find((result) => result.optionId === optionId)?.label).filter((label): label is string => Boolean(label))
}

function outcomeText(round: RoundRecord) {
  const outcome = round.outcome!
  if (isDecision(round) && round.decisionFormat === 'boolean') return decisionVerdict(round, outcome)
  const elected = namesOf(round, outcome.elected)
  const continuing = namesOf(round, outcome.runoff)
  const parts: string[] = []
  if (elected.length) {
    const heading = isDecision(round) ? RESULT_WORDING.approved : elected.length === 1 ? winnerText(round, elected[0]) : RESULT_WORDING.elected
    parts.push(`${heading}: ${formatNames(elected)}`)
  }
  if (continuing.length) parts.push(`${RESULT_WORDING.continuing}: ${formatNames(continuing)}`)
  return parts.join(' · ') || 'Sin electos'
}

function nextStepOf(round: RoundRecord) {
  const outcome = round.outcome!
  if (isDecision(round)) {
    if (round.decisionFormat === 'boolean' || outcome.elected.length) return NEXT_STEP.decided
    return outcome.runoff.length ? NEXT_STEP.runoff : NEXT_STEP.boardDecides
  }
  if (outcome.openSeats <= 0) return NEXT_STEP.electionComplete
  if (!outcome.runoff.length) return NEXT_STEP.boardDecides
  return `${NEXT_STEP.runoff} por ${outcome.openSeats} ${outcome.openSeats === 1 ? 'puesto' : 'puestos'}`
}
