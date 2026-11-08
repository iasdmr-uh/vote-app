import type { VotingService } from '../../src/voting/voting.service.js'

type CloseWhenEveryoneVoted = (assemblyId: string, roundId: string) => Promise<void>

export function trackAutoClose(service: VotingService) {
  const running: Array<Promise<void>> = []
  const closeWhenEveryoneVoted = (service as unknown as { closeWhenEveryoneVoted: CloseWhenEveryoneVoted }).closeWhenEveryoneVoted.bind(service)
  Object.assign(service, {
    closeWhenEveryoneVoted: (assemblyId: string, roundId: string) => {
      const closing = closeWhenEveryoneVoted(assemblyId, roundId)
      running.push(closing)
      return closing
    },
  })
  return async () => {
    await Promise.all(running.splice(0))
  }
}
