import { decisionOutcome, electionOutcome, thresholdVotes, type DecisionFormat, type DecisionOutcome, type ElectionOutcome, type ThresholdRule } from './results-engine.js'

export const SETTLED_ROUND_STATUSES = ['closed', 'published', 'annulled'] as const

export function seatsOf(round: { category: string; memberCount: number | null; electionSeats: number | null }) {
  return round.category === 'committee' ? Math.max(1, round.electionSeats ?? round.memberCount ?? 1) : 1
}

export type OutcomeRound = {
  category: string; memberCount: number | null; electionSeats: number | null; decisionFormat: string | null; approvalRule: string
  options: Array<{ id: string }>
}

export function outcomeOf(round: OutcomeRound, counts: Array<{ optionId: string; count: number }>, base: number): ElectionOutcome | DecisionOutcome {
  const countOf = new Map(counts.map((row) => [row.optionId, row.count]))
  const tallies = round.options.map((option) => ({ optionId: option.id, count: countOf.get(option.id) ?? 0 }))
  if (round.category === 'decision') return decisionOutcome(tallies, round.decisionFormat as DecisionFormat, base, round.approvalRule as ThresholdRule)
  return electionOutcome(tallies, seatsOf(round), base)
}

export const BOOLEAN_DECISION_LABELS = ['A favor', 'En contra'] as const

type DecisionFields = { decisionFormat?: string | null; approvalRule?: string; approvalThreshold?: number }

export function decisionFields(round: { category: string; decisionFormat: string | null; approvalRule: string; eligibleCount: number | null }): DecisionFields {
  if (round.category !== 'decision') return {}
  const fields = { decisionFormat: round.decisionFormat, approvalRule: round.approvalRule }
  return round.eligibleCount === null ? fields : { ...fields, approvalThreshold: thresholdVotes(round.eligibleCount, round.approvalRule as ThresholdRule) }
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
