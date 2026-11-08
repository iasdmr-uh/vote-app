import { decisionOutcome, decisionReasons, electionOutcome, electionReasons, type DecisionFormat, type DecisionOutcome, type ElectionOutcome, type ThresholdRule } from './results-engine.js'

export const SETTLED_ROUND_STATUSES = ['closed', 'published', 'annulled'] as const

export function seatsOf(round: { category: string; memberCount: number | null; electionSeats: number | null }) {
  return round.category === 'committee' ? Math.max(1, round.electionSeats ?? round.memberCount ?? 1) : 1
}

export type OutcomeRound = {
  category: string; memberCount: number | null; electionSeats: number | null; decisionFormat: string | null; approvalRule: string
  options: Array<{ id: string }>
}

function talliesOf(round: OutcomeRound, counts: Array<{ optionId: string; count: number }>) {
  const countOf = new Map(counts.map((row) => [row.optionId, row.count]))
  return round.options.map((option) => ({ optionId: option.id, count: countOf.get(option.id) ?? 0 }))
}

export function outcomeOf(round: OutcomeRound, counts: Array<{ optionId: string; count: number }>, base: number): ElectionOutcome | DecisionOutcome {
  const tallies = talliesOf(round, counts)
  if (round.category === 'decision') return decisionOutcome(tallies, round.decisionFormat as DecisionFormat, base, round.approvalRule as ThresholdRule)
  return electionOutcome(tallies, seatsOf(round), base)
}

export type ExplanationRound = OutcomeRound & { regionalSecretaryVotes: boolean; regionalSecretaryInBase: boolean | null }

export function explanationOf(round: ExplanationRound, counts: Array<{ optionId: string; count: number }>, base: number) {
  const tallies = talliesOf(round, counts)
  const decision = round.category === 'decision'
  const rule: ThresholdRule = decision ? round.approvalRule as ThresholdRule : 'simple'
  const reasons = decision ? decisionReasons(tallies, round.decisionFormat as DecisionFormat, base, rule) : electionReasons(tallies, seatsOf(round), base, rule)
  const baseIncludesSecretary = (round.regionalSecretaryInBase ?? round.regionalSecretaryVotes) && base > 0
  return { rule, reasons, baseDelegates: baseIncludesSecretary ? base - 1 : base, baseIncludesSecretary }
}

export const BOOLEAN_DECISION_LABELS = ['A favor', 'En contra'] as const

export function decisionFields(round: { category: string; decisionFormat: string | null; approvalRule: string }) {
  return round.category === 'decision' ? { decisionFormat: round.decisionFormat, approvalRule: round.approvalRule } : {}
}

export function isRunoff(countingRule: unknown) {
  const rule = countingRule as { reason?: unknown; runoff?: unknown } | null
  return runoffSourceOf(countingRule) !== null || (rule?.reason === 'repeat' && rule.runoff === true)
}

export function voteNumberIn(chain: Array<{ id: string; status: string }>, roundId: string) {
  const index = chain.findIndex((item) => item.id === roundId)
  return chain.slice(0, Math.max(0, index)).filter((item) => item.status !== 'annulled').length + 1
}

export function runoffSourceOf(countingRule: unknown) {
  const rule = countingRule as { reason?: unknown; sourceRoundId?: unknown } | null
  return rule?.reason === 'runoff' && typeof rule.sourceRoundId === 'string' ? rule.sourceRoundId : null
}

export function waitsForSourceResult(status: string, countingRule: unknown, statusById: Map<string, string>) {
  const sourceId = runoffSourceOf(countingRule)
  return status === 'draft' && sourceId !== null && statusById.get(sourceId) === 'closed'
}
