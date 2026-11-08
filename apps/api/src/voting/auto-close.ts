export function everyoneHasVoted(canVote: readonly string[], voted: ReadonlySet<string>) {
  return canVote.length > 0 && canVote.every((id) => voted.has(id))
}
