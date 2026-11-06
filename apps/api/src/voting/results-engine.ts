/**
 * Automatic results (Asamblea, Nov 2026). Pure functions: no database, no clock, so every rule is
 * tested in isolation and the mesa never picks a winner by hand.
 */

/** 'simple': more than half of the base. 'three_quarters': at least 3/4 of the base, rounded up. */
export type ThresholdRule = 'simple' | 'three_quarters'

/**
 * Fewest votes that reach the rule over the base (participants enabled when the vote closed).
 * Simple: 38 → 20 (exactly half is not a majority). 3/4: 38 → 29.
 */
export function thresholdVotes(base: number, rule: ThresholdRule = 'simple') {
  const safeBase = Math.max(0, Math.trunc(base))
  const votes = rule === 'three_quarters' ? Math.ceil((safeBase * 3) / 4) : Math.floor(safeBase / 2) + 1
  // With no one enabled, nobody can reach a threshold of zero votes.
  return Math.max(1, votes)
}

export function meetsThreshold(votes: number, base: number, rule: ThresholdRule = 'simple') {
  return votes >= thresholdVotes(base, rule)
}

export type Tally = { optionId: string; count: number }

export type ElectionOutcome = {
  /** Seats this vote fills (1 for an office). */
  seats: number
  base: number
  threshold: number
  /** Elected in this vote, most voted first. */
  elected: string[]
  /** Candidates that go to the next vote, most voted first; empty when every seat is filled. */
  runoff: string[]
  /** Seats still open after this vote; the next vote asks for exactly this many. */
  openSeats: number
}

/**
 * Elected: within the top `seats` places AND with a majority of the base. When more candidates have a
 * majority than seats, the most voted win; a tie at the cut goes to a runoff among only the tied ones.
 * Runoff pool: those in the top places without majority plus anyone tied at the cut. If that leaves no
 * more candidates than open seats, the next ranked candidate (and anyone tied with it) also goes.
 * Ties keep the ballot order of `tallies`.
 */
export function electionOutcome(tallies: Tally[], seats: number, base: number, rule: ThresholdRule = 'simple'): ElectionOutcome {
  const wanted = Math.max(1, Math.trunc(seats))
  const threshold = thresholdVotes(base, rule)
  const ranked = tallies.map((tally, order) => ({ ...tally, order })).sort((a, b) => b.count - a.count || a.order - b.order)
  const cut = ranked[Math.min(wanted, ranked.length) - 1]?.count ?? 0
  const top = ranked.filter((item) => item.count >= cut)
  const tiedAtCut = top.length > wanted
  // With a tie at the cut, the tied group cannot be split by votes, so none of it is elected here.
  const settled = tiedAtCut ? top.filter((item) => item.count > cut) : top
  const elected = settled.filter((item) => item.count >= threshold)
  const electedIds = new Set(elected.map((item) => item.optionId))
  const openSeats = wanted - elected.length
  if (openSeats <= 0) return { seats: wanted, base, threshold, elected: elected.map((item) => item.optionId), runoff: [], openSeats: 0 }
  const pool = top.filter((item) => !electedIds.has(item.optionId))
  if (pool.length <= openSeats) {
    const next = ranked[top.length]
    if (next) pool.push(...ranked.slice(top.length).filter((item) => item.count === next.count))
  }
  return { seats: wanted, base, threshold, elected: elected.map((item) => item.optionId), runoff: pool.map((item) => item.optionId), openSeats }
}

/** Whether more candidates share the last seat's vote count than there are seats left to give them. */
export function tiedAtCut(tallies: Tally[], seats: number) {
  const wanted = Math.max(1, Math.trunc(seats))
  const counts = tallies.map((tally) => tally.count).sort((a, b) => b - a)
  const cut = counts[Math.min(wanted, counts.length) - 1] ?? 0
  return counts.filter((count) => count >= cut).length > wanted
}

/** A decision: 'boolean' is A favor / En contra; with 'options' the mesa writes the choices. */
export type DecisionFormat = 'boolean' | 'options'

export type DecisionOutcome = ElectionOutcome & {
  rule: ThresholdRule
  /** Boolean: "A favor" reached the rule. Options: one option did, and it is the only one in `elected`. */
  approved: boolean
}

/**
 * Decisions are single choice with no abstention, over the same frozen base as elections.
 * Boolean: approved when "A favor" (the first tally, in ballot order) reaches the rule; otherwise not
 * approved, a tie included, and nothing repeats. `elected` stays empty: no option is elected.
 * Options: the most voted needs the rule; otherwise the vote repeats between the top 2 plus ties,
 * exactly as an office runoff does.
 */
export function decisionOutcome(tallies: Tally[], format: DecisionFormat, base: number, rule: ThresholdRule = 'simple'): DecisionOutcome {
  if (format === 'boolean') {
    const threshold = thresholdVotes(base, rule)
    const approved = (tallies[0]?.count ?? 0) >= threshold
    return { seats: 1, base, threshold, elected: [], runoff: [], openSeats: 0, rule, approved }
  }
  const outcome = electionOutcome(tallies, 1, base, rule)
  return { ...outcome, rule, approved: outcome.elected.length > 0 }
}
