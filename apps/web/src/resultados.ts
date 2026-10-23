import type { RoundRecord } from './types'

/** Equal counts share a position, so a tie never looks like a winner. */
export function rankOf(results: Array<{ count: number }>, index: number) {
  const result = results[index]
  if (!result) return ''
  return `${results.filter((other) => other.count > result.count).length + 1}.`
}

/**
 * The tie that matters for the decision: first place for an office, the last seat for a committee.
 * A committee tie among people who all fit in the seats needs no repetition.
 */
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

/**
 * Rounded share for the projector. A committee delegate marks several names, so its shares are over the
 * people who voted (`voters`) and do not add up to 100 %; an office's are over the votes counted.
 */
export function resultPercent(results: Array<{ count: number }>, count: number, voters?: number | null) {
  const total = voters ?? results.reduce((sum, result) => sum + result.count, 0)
  return total ? Math.round((count / total) * 100) : 0
}

/** Voters behind a committee's shares; an office's shares need none. */
export function committeeVoters(target: { category?: string; participationCount?: number } | undefined, voters = target?.participationCount) {
  return target?.category === 'committee' ? voters ?? null : null
}

export function countsOf(target: RoundRecord) {
  return target.results?.length ? target.results : target.privateResults || []
}

/** A repetition copies the options under new ids, so its counts are matched by label too. */
export function voteCountOf(target: RoundRecord, option: { id: string; label: string }) {
  const counts = countsOf(target)
  return (counts.find((result) => result.optionId === option.id) || counts.find((result) => result.label === option.label))?.count ?? 0
}
