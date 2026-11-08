import { es } from './locale/es'
import { chainVoteNumber, countsOf, decisionVerdict, displayOrder, formatNames, isDecision, majorityText, outcomeTag, voteLabel, winnerText } from './resultados'
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
  open: es.moderator.progress.voteOpen,
  counting: es.results.preparing,
  counted: '',
  annulled: es.moderator.progress.annulled,
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
    heading: voteLabel({ voteNumber: chainVoteNumber(round, rounds), runoff: round.runoff }) || es.results.firstVote,
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
      tag: tag === 'elected' ? winnerText(round, result.label) : tag === 'runoff' ? es.results.runoffTag : null,
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
    const heading = isDecision(round) ? es.results.approved : elected.length === 1 ? winnerText(round, elected[0]) : es.results.elected
    parts.push(`${heading}: ${formatNames(elected)}`)
  }
  if (continuing.length) parts.push(`${es.results.continuing}: ${formatNames(continuing)}`)
  return parts.join(' · ') || es.moderator.progress.noneElected
}

function nextStepOf(round: RoundRecord) {
  const outcome = round.outcome!
  if (isDecision(round)) {
    if (round.decisionFormat === 'boolean' || outcome.elected.length) return es.moderator.progress.decided
    return outcome.runoff.length ? es.moderator.progress.runoff : es.moderator.progress.boardDecides
  }
  if (outcome.openSeats <= 0) return es.moderator.progress.electionComplete
  if (!outcome.runoff.length) return es.moderator.progress.boardDecides
  return es.moderator.progress.runoffForSeats(outcome.openSeats)
}
